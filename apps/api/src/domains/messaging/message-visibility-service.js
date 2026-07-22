'use strict';

class MessageVisibilityError extends Error {
  constructor() {
    super('Message is not visible');
    this.name = 'MessageVisibilityError';
    this.code = 'message_not_visible';
  }
}

function participantIds(message) {
  return new Set([
    message?.senderId || message?.sender_id,
    message?.recipientId || message?.recipient_id
  ].filter(Boolean));
}

function createMessageVisibilityService({ roomAdapter, directAdapter } = {}) {
  const roomPolicy = roomAdapter || {
    canView(context) {
      if (typeof context?.authorized === 'boolean') return context.authorized;
      return Boolean(context?.room && !context.room.deletedAt && !context.room.deleted_at);
    }
  };
  const directPolicy = directAdapter || {
    canView(context) {
      if (context?.authorized === false) return false;
      const viewerId = context?.viewerId || context?.userId;
      if (!context?.message) return context?.authorized === true;
      return Boolean(viewerId && participantIds(context.message).has(viewerId));
    }
  };

  async function canViewRoomMessage(context) {
    return (await roomPolicy.canView(context)) === true;
  }

  async function canViewDirectMessage(context) {
    return (await directPolicy.canView(context)) === true;
  }

  async function requireRoomMessage(context) {
    if (!(await canViewRoomMessage(context))) throw new MessageVisibilityError();
    return context?.message || null;
  }

  async function requireDirectMessage(context) {
    if (!(await canViewDirectMessage(context))) throw new MessageVisibilityError();
    return context?.message || null;
  }

  return Object.freeze({
    canViewDirectMessage,
    canViewRoomMessage,
    requireDirectMessage,
    requireRoomMessage
  });
}

module.exports = {
  MessageVisibilityError,
  createMessageVisibilityService
};
