import type { Readable } from 'node:stream';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { Attachment, AttachmentRepository } from './attachment.repository.ts';
import type { MediaStorage } from './storage.ts';
import { ownsAttachment } from './attachment.policy.ts';

type AttachmentCheck = (input: { attachment: Attachment; viewerId: string }) => unknown;

export type OpenedMedia = Readonly<{ bytes: number; extension: 'webp'; mimeType: 'image/webp'; stream: Readable }>;

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
    if (variant !== 'preview' && variant !== 'processed') throw notFound();
    const visible = await attachments.findById(attachmentId);
    if (!visible) throw notFound();
    await requireVisible(visible, viewerId);
    const opened = await files.openRead(visible.id, variant).catch(() => {
      onAuthorizationInvariantFailure();
      throw notFound();
    });
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
