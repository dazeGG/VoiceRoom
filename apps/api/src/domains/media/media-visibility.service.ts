import type { Readable } from 'node:stream';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { Attachment, AttachmentRepository } from './attachment.repository.ts';
import type { MediaStorage } from './storage.ts';
import { attachmentFileName, ownsAttachment } from './attachment.policy.ts';
import { DIAGNOSTICS_MIME_TYPE } from '@voiceroom/shared/contracts/media';

type AttachmentCheck = (input: { attachment: Attachment; viewerId: string }) => unknown;

/** An image variant, or the diagnostics file itself. */
export type OpenedMedia =
  | Readonly<{ bytes: number; extension: 'webp'; mimeType: 'image/webp'; stream: Readable }>
  | Readonly<{
      bytes: number;
      extension: 'txt';
      mimeType: 'text/plain; charset=utf-8';
      fileName: string;
      stream: Readable;
    }>;

/**
 * The headers an opened attachment is sent with. An image shows inline unless
 * asked for as a download; the diagnostics file is always a download the
 * browser must not sniff into anything else.
 */
export function openedMediaHeaders(opened: OpenedMedia, download: boolean): Record<string, string> {
  if (opened.extension === 'txt') {
    return {
      'Content-Disposition': `attachment; filename="${opened.fileName}"`,
      'Content-Length': String(opened.bytes),
      'Content-Type': opened.mimeType,
      'X-Content-Type-Options': 'nosniff'
    };
  }
  return {
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="image.${opened.extension}"`,
    'Content-Length': String(opened.bytes),
    'Content-Type': opened.mimeType
  };
}

// Every refusal looks the same, so a viewer cannot tell a hidden attachment from a missing one.
function notFound(): DomainError {
  return new DomainError('media_not_found', 404, 'Attachment not found');
}

// A context wired without its check shows nothing.
const denyAll: AttachmentCheck = async () => false;

function createMediaVisibilityService({
  attachmentRepository: attachments,
  authorizeDirectAttachment = denyAll,
  authorizeRoomAttachment = denyAll,
  storage: files,
  onAuthorizationInvariantFailure = () => {}
}: {
  attachmentRepository: Pick<AttachmentRepository, 'findById'>;
  authorizeDirectAttachment?: AttachmentCheck;
  authorizeRoomAttachment?: AttachmentCheck;
  storage: Pick<MediaStorage, 'openRead'>;
  onAuthorizationInvariantFailure?: () => void;
}) {
  async function requireVisible(attachment: Attachment | null, viewerId: string): Promise<void> {
    if (!attachment || attachment.internalState !== 'ready' || attachment.deletedAt) throw notFound();
    if (!attachment.boundAt) {
      if (!ownsAttachment(attachment, viewerId)) throw notFound();
      return;
    }
    if (attachment.context === 'room') {
      if ((await authorizeRoomAttachment({ attachment, viewerId })) !== true) throw notFound();
      return;
    }
    if (attachment.context === 'dm') {
      if ((await authorizeDirectAttachment({ attachment, viewerId })) !== true) throw notFound();
      return;
    }
    onAuthorizationInvariantFailure();
    throw notFound();
  }

  async function open({
    attachmentId,
    variant,
    viewerId
  }: {
    attachmentId: string;
    variant: unknown;
    viewerId: string;
  }): Promise<OpenedMedia> {
    if (variant !== 'preview' && variant !== 'processed' && variant !== 'file') throw notFound();
    const visible = await attachments.findById(attachmentId);
    if (!visible) throw notFound();
    await requireVisible(visible, viewerId);
    // A file has only itself; an image has only its variants.
    const isFile = visible.mimeType === DIAGNOSTICS_MIME_TYPE;
    const fileName = attachmentFileName(visible);
    if (isFile !== (variant === 'file') || (isFile && !fileName)) throw notFound();
    const opened = await files.openRead(visible.id, isFile ? 'original' : variant).catch(() => {
      onAuthorizationInvariantFailure();
      throw notFound();
    });
    if (isFile && fileName) {
      return Object.freeze({
        bytes: opened.bytes,
        extension: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        fileName,
        stream: opened.stream
      });
    }
    return Object.freeze({
      bytes: opened.bytes,
      extension: 'webp',
      mimeType: 'image/webp',
      stream: opened.stream
    });
  }

  return Object.freeze({ open, requireVisible });
}

export { createMediaVisibilityService };
