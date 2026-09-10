'use strict';

class MediaVisibilityError extends Error {
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
} = {}) {
  if (!attachmentRepository || !storage) throw new TypeError('Media visibility dependencies are required');

  async function requireVisible(attachment, viewerId) {
    if (!attachment || attachment.internalState !== 'ready' || attachment.deletedAt) throw new MediaVisibilityError();
    if (!attachment.boundAt) {
      if (attachment.ownerId !== viewerId) throw new MediaVisibilityError();
      return;
    }
    if (attachment.context === 'room') {
      if (authorizeRoomAttachment) {
        if (await authorizeRoomAttachment({ attachment, viewerId }) !== true) throw new MediaVisibilityError();
        return;
      }
      const message = await resolveRoomMessage?.(attachment.roomMessageId);
      const visible = await messageVisibilityService?.canViewRoomMessage({ attachment, message, viewerId });
      if (!visible) throw new MediaVisibilityError();
      return;
    }
    if (attachment.context === 'dm') {
      if (authorizeDirectAttachment) {
        if (await authorizeDirectAttachment({ attachment, viewerId }) !== true) throw new MediaVisibilityError();
        return;
      }
      const message = await resolveDirectMessage?.(attachment.directMessageId);
      const visible = await messageVisibilityService?.canViewDirectMessage({ attachment, message, viewerId });
      if (!visible) throw new MediaVisibilityError();
      return;
    }
    onAuthorizationInvariantFailure(); throw new MediaVisibilityError();
  }

  async function open({ attachmentId, variant, viewerId }) {
    if (variant !== 'preview' && variant !== 'processed') throw new MediaVisibilityError();
    const attachment = await attachmentRepository.findById(attachmentId);
    await requireVisible(attachment, viewerId);
    const opened = await storage.openRead(attachment.id, variant).catch(() => { onAuthorizationInvariantFailure(); throw new MediaVisibilityError(); });
    return Object.freeze({
      bytes: opened.bytes,
      extension: 'webp',
      mimeType: 'image/webp',
      stream: opened.stream
    });
  }

  return Object.freeze({ open, requireVisible });
}

module.exports = { MediaVisibilityError, createMediaVisibilityService };
