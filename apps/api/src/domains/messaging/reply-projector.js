'use strict';

const { REPLY_PREVIEW_TEXT_MAX_LENGTH, isSystemCard } = require('@voice-room/shared/messaging-send');

const REPLY_TOMBSTONE_TEXT = 'Сообщение недоступно';

class ReplyTargetUnavailableError extends Error {
  constructor() {
    super('Reply target is unavailable');
    this.name = 'ReplyTargetUnavailableError';
    this.code = 'reply_target_unavailable';
    this.statusCode = 409;
  }
}

function toMillis(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageId(message) {
  return String(message?.id || message?.messageId || message?.message_id || '');
}

function isInvitation(message) {
  const metadata = message?.metadata;
  return message?.invite != null
    || metadata?.kind === 'room-invite'
    || message?.kind === 'room-invite';
}

function isReplyTargetKindAllowed(message) {
  if (!message || !messageId(message)) return false;
  return !isInvitation(message) && !isSystemCard(message?.content ?? message?.kind ?? message?.type ?? message?.metadata);
}

function isUnavailable(message, now = Date.now()) {
  if (!message) return true;
  if (message.deleted === true || message.deletedAt || message.deleted_at) return true;
  const expiresAt = toMillis(message.expiresAt ?? message.expires_at);
  return expiresAt !== null && expiresAt <= now;
}

function projectAuthor(message) {
  const id = message.authorUserId || message.author_user_id || message.senderId || message.sender_id || message.peerId || message.peer_id;
  const name = message.name || message.displayName || message.author?.name || message.author?.displayName;
  const author = {};
  if (id) author.id = String(id);
  if (name) author.name = String(name);
  return Object.keys(author).length ? author : undefined;
}

function projectText(message) {
  const value = message.text ?? message.body ?? message.content?.text;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, REPLY_PREVIEW_TEXT_MAX_LENGTH) : undefined;
}

function projectReplyTombstone(pointer) {
  const id = typeof pointer === 'string' ? pointer : messageId(pointer);
  return Object.freeze({
    messageId: id,
    deleted: true,
    text: REPLY_TOMBSTONE_TEXT
  });
}

function projectReplyPreview(message, { now = Date.now() } = {}) {
  const id = messageId(message);
  if (!id) return null;
  if (isUnavailable(message, now)) return projectReplyTombstone(id);
  if (!isReplyTargetKindAllowed(message)) return null;

  // Intentionally omit replyTo/replyPreview: previews are exactly one level.
  const preview = { messageId: id, deleted: false };
  const author = projectAuthor(message);
  const text = projectText(message);
  if (author) preview.author = author;
  if (text) preview.text = text;
  return Object.freeze(preview);
}

async function requireReplyTarget({ message, visibility, visibilityContext, now = Date.now() } = {}) {
  if (!isReplyTargetKindAllowed(message) || isUnavailable(message, now)) {
    throw new ReplyTargetUnavailableError();
  }

  const visible = typeof visibility === 'function'
    ? await visibility({ ...visibilityContext, message })
    : visibility === true;
  if (visible !== true) throw new ReplyTargetUnavailableError();

  const preview = projectReplyPreview(message, { now });
  if (!preview) throw new ReplyTargetUnavailableError();
  return preview;
}

module.exports = {
  REPLY_TOMBSTONE_TEXT,
  ReplyTargetUnavailableError,
  isReplyTargetKindAllowed,
  projectReplyPreview,
  projectReplyTombstone,
  requireReplyTarget
};
