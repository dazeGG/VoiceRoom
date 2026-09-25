import type { ReadStream } from 'node:fs';
import type { Attachment, AttachmentRepository } from './attachment-repository.ts';
import type { MediaStorage } from './storage.ts';

type AttachmentCheck = (input: { attachment: Attachment; viewerId: string }) => unknown;
type MessageCheck = (input: { attachment: Attachment; message: unknown; viewerId: string }) => unknown;

export type OpenedMedia = Readonly<{ bytes: number; extension: 'webp'; mimeType: 'image/webp'; stream: ReadStream }>;

class MediaVisibilityError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor() {
    super('Attachment not found');
    this.name = 'MediaVisibilityError';
    this.code = 'media_not_found';
    this.statusCode = 404;
  }
}

function createMediaVisibilityService({
  attachmentRepository,
  authorizeDirectAttachment,
  authorizeRoomAttachment,
  messageVisibilityService,
  resolveRoomMessage,
  resolveDirectMessage,
  storage,
  onAuthorizationInvariantFailure = () => {}
}: {
  attachmentRepository?: Pick<AttachmentRepository, 'findById'>;
  authorizeDirectAttachment?: AttachmentCheck;
  authorizeRoomAttachment?: AttachmentCheck;
  messageVisibilityService?: { canViewRoomMessage: MessageCheck; canViewDirectMessage: MessageCheck } | null;
  resolveRoomMessage?: (id: string | null) => unknown;
  resolveDirectMessage?: (id: string | null) => unknown;
  storage?: Pick<MediaStorage, 'openRead'>;
  onAuthorizationInvariantFailure?: () => void;
} = {}) {
  if (!attachmentRepository || !storage) throw new TypeError('Media visibility dependencies are required');
  const attachments = attachmentRepository;
  const files = storage;

  async function requireVisible(attachment: Attachment | null, viewerId: string): Promise<void> {
    if (!attachment || attachment.internalState !== 'ready' || attachment.deletedAt) throw new MediaVisibilityError();
    if (!attachment.boundAt) {
      if (attachment.ownerId !== viewerId) throw new MediaVisibilityError();
      return;
    }
    if (attachment.context === 'room') {
      if (authorizeRoomAttachment) {
        if ((await authorizeRoomAttachment({ attachment, viewerId })) !== true) throw new MediaVisibilityError();
        return;
      }
      const message = await resolveRoomMessage?.(attachment.roomMessageId);
      const visible = await messageVisibilityService?.canViewRoomMessage({ attachment, message, viewerId });
      if (!visible) throw new MediaVisibilityError();
      return;
    }
    if (attachment.context === 'dm') {
      if (authorizeDirectAttachment) {
        if ((await authorizeDirectAttachment({ attachment, viewerId })) !== true) throw new MediaVisibilityError();
        return;
      }
      const message = await resolveDirectMessage?.(attachment.directMessageId);
      const visible = await messageVisibilityService?.canViewDirectMessage({ attachment, message, viewerId });
      if (!visible) throw new MediaVisibilityError();
      return;
    }
    onAuthorizationInvariantFailure();
    throw new MediaVisibilityError();
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
    if (variant !== 'preview' && variant !== 'processed') throw new MediaVisibilityError();
    const attachment = await attachments.findById(attachmentId);
    await requireVisible(attachment, viewerId);
    // requireVisible throws for a missing attachment.
    const visible = attachment as Attachment;
    const opened = await files.openRead(visible.id, variant).catch(() => {
      onAuthorizationInvariantFailure();
      throw new MediaVisibilityError();
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

export { MediaVisibilityError, createMediaVisibilityService };
