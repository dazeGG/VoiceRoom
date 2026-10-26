import type pg from 'pg';
import sharp from 'sharp';
import type { AttachmentDraft } from '@voice-room/shared/contracts/media';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { codeOf } from '../../platform/error-code.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { Attachment, AttachmentRepository } from './attachment.repository.ts';
import type { MediaJobRepository } from './media-job.repository.ts';
import type { MediaPressureService } from './media-pressure.service.ts';
import type { MediaQuotaService } from './media-quota.service.ts';
import { chunkBuffer, type ByteChunks, type MediaStorage } from './storage.ts';
import { ownsAttachment } from './attachment.policy.ts';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024;
const FORMAT_MIME: Readonly<Record<string, string>> = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
});
const PNG_END = Buffer.from('0000000049454e44ae426082', 'hex');

type Client = Pick<pg.PoolClient, 'query'> | null | undefined;
type ImageMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
type UploadStream = ByteChunks & { resume?: () => unknown };

export type PublicAttachment = Readonly<AttachmentDraft>;

function publicAttachment(attachment: Attachment | null | undefined): PublicAttachment | null {
  if (!attachment) return null;
  return Object.freeze({
    id: attachment.id,
    context: attachment.context,
    state: attachment.state,
    mimeType: attachment.mimeType,
    bytes: attachment.originalBytes,
    width: attachment.width,
    height: attachment.height,
    failureCode: attachment.failureCode,
    createdAt: epochMillis(attachment.createdAt),
    updatedAt: epochMillis(attachment.updatedAt)
  });
}

async function readBounded(stream: ByteChunks, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const value = chunkBuffer(chunk);
    bytes += value.length;
    if (bytes > maxBytes) throw new DomainError('media_too_large', 413, 'Image exceeds 10 MiB');
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}

function detectExactContainer(buffer: Buffer): '' | 'jpeg' | 'png' | 'webp' {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer.at(-2) === 0xff &&
    buffer.at(-1) === 0xd9
  )
    return 'jpeg';
  if (
    buffer.length >= 20 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(-PNG_END.length).equals(PNG_END)
  )
    return 'png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    buffer.readUInt32LE(4) + 8 === buffer.length
  )
    return 'webp';
  return '';
}

function createMediaService({
  attachmentRepository: attachments,
  jobRepository,
  pressureService,
  quotaService: quotas,
  storage: files,
  maxUploadBytes = MAX_UPLOAD_BYTES,
  maxInputPixels = MAX_INPUT_PIXELS
}: {
  attachmentRepository: Pick<
    AttachmentRepository,
    | 'findById'
    | 'markUploaded'
    | 'markFailed'
    | 'markDeleted'
    | 'retryProcessing'
    | 'withAttachmentLock'
    | 'clearPhysicalData'
  >;
  jobRepository: Pick<MediaJobRepository, 'enqueue'>;
  pressureService: Pick<MediaPressureService, 'assertAcceptingUploads'>;
  quotaService: MediaQuotaService;
  storage: Pick<MediaStorage, 'openRead' | 'save' | 'removeAttachment'>;
  maxUploadBytes?: number;
  maxInputPixels?: number;
}) {
  async function owned(id: string, ownerId: string, client?: Client): Promise<Attachment> {
    const attachment = await attachments.findById(id, { client });
    if (!ownsAttachment(attachment, ownerId) || attachment.deletedAt) {
      throw new DomainError('media_not_found', 404, 'Attachment not found');
    }
    return attachment;
  }

  async function createSlot({
    ownerId,
    context,
    clientRequestId,
    bytes,
    metadata = {}
  }: {
    ownerId: string;
    context?: unknown;
    clientRequestId?: unknown;
    bytes?: unknown;
    metadata?: unknown;
  }): Promise<PublicAttachment | null> {
    await pressureService.assertAcceptingUploads();
    if (context !== 'room' && context !== 'dm')
      throw new DomainError('media_context_invalid', 400, 'Invalid attachment context');
    if (typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
      throw new DomainError('media_request_id_required', 400, 'Client request id is required');
    }
    if (Number(bytes) > maxUploadBytes) throw new DomainError('media_too_large', 413, 'Image exceeds 10 MiB');
    const attachment = await quotas.reserve({
      ownerId,
      context,
      clientRequestId: clientRequestId.trim(),
      bytes,
      metadata
    });
    return publicAttachment(attachment);
  }

  async function inspectOriginal(
    attachmentId: string,
    claimedMimeType: string | undefined
  ): Promise<{ height: number; mimeType: string; width: number }> {
    const opened = await files.openRead(attachmentId, 'original');
    const buffer = await readBounded(opened.stream, maxUploadBytes);
    const container = detectExactContainer(buffer);
    if (!container) throw new DomainError('media_invalid_image', 400, 'Invalid or unsafe image container');
    let metadata: ImageMetadata;
    try {
      const image = sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: maxInputPixels,
        sequentialRead: true
      });
      metadata = await image.metadata();
      await image.clone().resize(1, 1, { fit: 'inside' }).toBuffer();
    } catch (cause) {
      throw new DomainError('media_invalid_image', 400, 'Invalid or unsafe image', { cause });
    }
    const mimeType = metadata.format ? FORMAT_MIME[metadata.format] : undefined;
    if (!mimeType || metadata.format !== container)
      throw new DomainError('media_type_unsupported', 415, 'Only JPEG, PNG, and WebP images are supported');
    if (claimedMimeType && claimedMimeType !== 'application/octet-stream' && claimedMimeType !== mimeType) {
      throw new DomainError('media_type_mismatch', 415, 'Image content does not match its MIME type');
    }
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > maxInputPixels) {
      throw new DomainError('media_pixel_limit', 413, 'Image dimensions exceed the safe limit');
    }
    return { height, mimeType, width };
  }

  async function upload({
    id,
    ownerId,
    stream,
    mimeType
  }: {
    id: string;
    ownerId: string;
    stream?: UploadStream | null | undefined;
    mimeType?: string;
  }): Promise<PublicAttachment | null> {
    await pressureService.assertAcceptingUploads();
    if (!stream) throw new DomainError('media_body_required', 400, 'Image body is required');
    const body = stream;
    return attachments.withAttachmentLock(id, async (client) => {
      const attachment = await owned(id, ownerId, client);
      if (attachment.internalState === 'processing' || attachment.state === 'ready') {
        body.resume?.();
        return publicAttachment(attachment);
      }
      if (attachment.internalState !== 'uploading') {
        body.resume?.();
        throw new DomainError('media_state_conflict', 409, 'Attachment cannot be uploaded in its current state');
      }
      try {
        const saved = await files.save(id, 'original', body, { maxBytes: maxUploadBytes });
        if (attachment.reservedBytes && saved.bytes > attachment.reservedBytes) {
          throw new DomainError('media_size_mismatch', 413, 'Image exceeds its reserved size');
        }
        const image = await inspectOriginal(id, mimeType);
        const updated = await attachments.markUploaded(
          id,
          {
            mimeType: image.mimeType,
            bytes: saved.bytes,
            width: image.width,
            height: image.height,
            originalStorageKey: saved.key
          },
          client
        );
        if (!updated) throw new DomainError('media_state_conflict', 409, 'Attachment upload was superseded');
        await jobRepository.enqueue(id, { client });
        return publicAttachment(updated);
      } catch (error) {
        const code = codeOf(error);
        await files.removeAttachment(id).catch(() => {});
        if (code === 'MEDIA_TOO_LARGE') {
          await attachments.markFailed(id, 'media_too_large', client).catch(() => {});
          throw new DomainError('media_too_large', 413, 'Image exceeds 10 MiB');
        }
        await attachments.markFailed(id, code || 'media_invalid_image', client).catch(() => {});
        throw error;
      }
    });
  }

  async function status({ id, ownerId }: { id: string; ownerId: string }): Promise<PublicAttachment | null> {
    return publicAttachment(await owned(id, ownerId));
  }

  async function remove({ id, ownerId }: { id: string; ownerId: string }): Promise<PublicAttachment | null> {
    await owned(id, ownerId);
    const deleted = await attachments.markDeleted(id);
    await files.removeAttachment(id).catch(() => {});
    await attachments.clearPhysicalData(id).catch(() => {});
    return publicAttachment(deleted);
  }

  async function retry({ id, ownerId }: { id: string; ownerId: string }): Promise<PublicAttachment | null> {
    await pressureService.assertAcceptingUploads();
    const attachment = await owned(id, ownerId);
    if (attachment.internalState !== 'failed' || !attachment.storageKeys.original) {
      throw new DomainError('media_retry_unavailable', 409, 'Attachment cannot be retried');
    }
    const updated = await attachments.retryProcessing(id);
    await jobRepository.enqueue(id);
    return publicAttachment(updated);
  }

  return Object.freeze({ createSlot, remove, retry, status, upload });
}

export type MediaService = ReturnType<typeof createMediaService>;

export { MAX_UPLOAD_BYTES, createMediaService, detectExactContainer };
