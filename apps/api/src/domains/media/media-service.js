'use strict';

const sharp = require('sharp');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024;
const FORMAT_MIME = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
const PNG_END = Buffer.from('0000000049454e44ae426082', 'hex');

class MediaServiceError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'MediaServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function publicAttachment(attachment) {
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
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt
  });
}

async function readBounded(stream, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > maxBytes) throw new MediaServiceError('media_too_large', 'Image exceeds 10 MiB', 413);
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}

function detectExactContainer(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) return 'jpeg';
  if (buffer.length >= 20 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && buffer.subarray(-PNG_END.length).equals(PNG_END)) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length) return 'webp';
  return '';
}

function createMediaService({
  attachmentRepository,
  jobRepository,
  pressureService,
  quotaService,
  storage,
  maxUploadBytes = MAX_UPLOAD_BYTES,
  maxInputPixels = MAX_INPUT_PIXELS
} = {}) {
  if (!attachmentRepository || !storage || !quotaService) throw new TypeError('Media dependencies are required');

  async function owned(id, ownerId, client) {
    const attachment = await attachmentRepository.findById(id, { client });
    if (!attachment || attachment.ownerId !== ownerId || attachment.deletedAt) {
      throw new MediaServiceError('media_not_found', 'Attachment not found', 404);
    }
    return attachment;
  }

  async function createSlot({ ownerId, context, clientRequestId, bytes, metadata = {} }) {
    await pressureService?.assertAcceptingUploads?.();
    if (context !== 'room' && context !== 'dm') throw new MediaServiceError('media_context_invalid', 'Invalid attachment context', 400);
    if (typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
      throw new MediaServiceError('media_request_id_required', 'Client request id is required', 400);
    }
    if (Number(bytes) > maxUploadBytes) throw new MediaServiceError('media_too_large', 'Image exceeds 10 MiB', 413);
    const attachment = await quotaService.reserve({ ownerId, context, clientRequestId: clientRequestId.trim(), bytes, metadata });
    return publicAttachment(attachment);
  }

  async function inspectOriginal(attachmentId, claimedMimeType) {
    const opened = await storage.openRead(attachmentId, 'original');
    const buffer = await readBounded(opened.stream, maxUploadBytes);
    const container = detectExactContainer(buffer);
    if (!container) throw new MediaServiceError('media_invalid_image', 'Invalid or unsafe image container', 400);
    let metadata;
    try {
      const image = sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: maxInputPixels,
        sequentialRead: true
      });
      metadata = await image.metadata();
      await image.clone().resize(1, 1, { fit: 'inside' }).toBuffer();
    } catch (cause) {
      throw new MediaServiceError('media_invalid_image', 'Invalid or unsafe image', 400, { cause });
    }
    const mimeType = FORMAT_MIME[metadata.format];
    if (!mimeType || metadata.format !== container) throw new MediaServiceError('media_type_unsupported', 'Only JPEG, PNG, and WebP images are supported', 415);
    if (claimedMimeType && claimedMimeType !== 'application/octet-stream' && claimedMimeType !== mimeType) {
      throw new MediaServiceError('media_type_mismatch', 'Image content does not match its MIME type', 415);
    }
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > maxInputPixels) {
      throw new MediaServiceError('media_pixel_limit', 'Image dimensions exceed the safe limit', 413);
    }
    return { height, mimeType, width };
  }

  async function upload({ id, ownerId, stream, mimeType }) {
    await pressureService?.assertAcceptingUploads?.();
    if (!stream) throw new MediaServiceError('media_body_required', 'Image body is required', 400);
    const locked = attachmentRepository.withAttachmentLock || (async (_id, operation) => operation(undefined));
    return locked(id, async (client) => {
      const attachment = await owned(id, ownerId, client);
      if (attachment.internalState === 'processing' || attachment.state === 'ready') {
        stream.resume?.();
        return publicAttachment(attachment);
      }
      if (attachment.internalState !== 'uploading') {
        stream.resume?.();
        throw new MediaServiceError('media_state_conflict', 'Attachment cannot be uploaded in its current state', 409);
      }
      try {
        const saved = await storage.save(id, 'original', stream, { maxBytes: maxUploadBytes });
        if (attachment.reservedBytes && saved.bytes > attachment.reservedBytes) {
          throw new MediaServiceError('media_size_mismatch', 'Image exceeds its reserved size', 413);
        }
        const image = await inspectOriginal(id, mimeType);
        const updated = await attachmentRepository.markUploaded(id, {
          mimeType: image.mimeType,
          bytes: saved.bytes,
          width: image.width,
          height: image.height,
          originalStorageKey: saved.key
        }, client);
        if (!updated) throw new MediaServiceError('media_state_conflict', 'Attachment upload was superseded', 409);
        await jobRepository?.enqueue?.(id, { client });
        return publicAttachment(updated);
      } catch (error) {
        await storage.removeAttachment(id).catch(() => {});
        if (error?.code === 'MEDIA_TOO_LARGE') {
          await attachmentRepository.markFailed(id, 'media_too_large', client).catch(() => {});
          throw new MediaServiceError('media_too_large', 'Image exceeds 10 MiB', 413);
        }
        await attachmentRepository.markFailed(id, error?.code || 'media_invalid_image', client).catch(() => {});
        throw error;
      }
    });
  }

  async function status({ id, ownerId }) {
    return publicAttachment(await owned(id, ownerId));
  }

  async function remove({ id, ownerId }) {
    await owned(id, ownerId);
    const deleted = await attachmentRepository.markDeleted(id);
    await storage.removeAttachment(id).catch(() => {});
    await attachmentRepository.clearPhysicalData?.(id).catch(() => {});
    return publicAttachment(deleted);
  }

  async function retry({ id, ownerId }) {
    await pressureService?.assertAcceptingUploads?.();
    const attachment = await owned(id, ownerId);
    if (attachment.internalState !== 'failed' || !attachment.storageKeys.original) {
      throw new MediaServiceError('media_retry_unavailable', 'Attachment cannot be retried', 409);
    }
    const updated = await attachmentRepository.retryProcessing(id);
    await jobRepository?.enqueue?.(id);
    return publicAttachment(updated);
  }

  return Object.freeze({ createSlot, remove, retry, status, upload });
}

module.exports = {
  FORMAT_MIME,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
  MediaServiceError,
  createMediaService,
  detectExactContainer,
  publicAttachment
};
