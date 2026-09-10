'use strict';

const SEND_CONTRACT_VERSION = 1;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 160;
const IDEMPOTENCY_FINGERPRINT_MAX_LENGTH = 256;
const REPLY_PREVIEW_TEXT_MAX_LENGTH = 280;
const DELIVERY_EVENT_TYPES = Object.freeze(['message.created', 'message.updated', 'message.deleted']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : '';
}

function normalizeConversation(value) {
  if (!isObject(value)) return null;
  const type = value.type === 'dm' ? 'dm' : value.type === 'room' ? 'room' : '';
  const id = cleanString(value.id ?? value.roomId ?? value.userId ?? value.conversationId, 160);
  return type && id ? { type, id } : null;
}

function isSystemCard(value) {
  return value === 'system'
    || value === 'system-card'
    || value === 'invite'
    || (isObject(value) && (value.type === 'system' || value.type === 'system-card' || value.system === true));
}

function normalizeReplyPointer(value) {
  if (!isObject(value)) return null;
  if (isSystemCard(value.content ?? value.kind ?? value.type)) return null;
  const messageId = cleanString(value.messageId ?? value.id, 160);
  return messageId ? Object.freeze({ messageId }) : null;
}

function normalizeReplyPreview(value) {
  if (!isObject(value)) return null;
  const messageId = cleanString(value.messageId ?? value.id, 160);
  if (!messageId) return null;
  const preview = {
    messageId,
    deleted: Boolean(value.deleted),
    author: isObject(value.author) ? value.author : undefined,
    text: cleanString(value.text ?? value.content?.text, REPLY_PREVIEW_TEXT_MAX_LENGTH) || undefined
  };
  return preview;
}

function normalizeIdempotency(value) {
  if (!isObject(value)) return null;
  const key = cleanString(value.key, IDEMPOTENCY_KEY_MAX_LENGTH);
  const fingerprint = cleanString(value.fingerprint, IDEMPOTENCY_FINGERPRINT_MAX_LENGTH);
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || !fingerprint) return null;

  const actorType = value.actorType === 'guest' ? 'guest' : value.actorType === 'account' ? 'account' : '';
  const actorId = cleanString(value.actorId ?? value.peerId ?? value.userId, 160);
  const conversation = normalizeConversation(value.conversation);
  if (!actorType || !actorId || !conversation) return null;

  return { key, fingerprint, actorType, actorId, conversation };
}

function normalizeSendEnvelope(value) {
  if (!isObject(value)) return { ok: false, code: 'invalid_envelope' };
  if (value.contractVersion !== undefined && value.contractVersion !== SEND_CONTRACT_VERSION) {
    return { ok: true, legacy: true, envelope: null };
  }

  const conversation = normalizeConversation(value.conversation);
  if (!conversation) return { ok: false, code: 'invalid_conversation' };

  const content = value.content;
  if (isSystemCard(content)) return { ok: false, code: 'invalid_system_card_target' };

  const idempotency = normalizeIdempotency(value.idempotency);
  if (!idempotency) return { ok: false, code: 'invalid_idempotency' };

  const replyTo = value.replyTo === undefined || value.replyTo === null
    ? undefined
    : normalizeReplyPointer(value.replyTo);
  if (value.replyTo && !replyTo) return { ok: false, code: 'invalid_reply_target' };

  return {
    ok: true,
    legacy: false,
    envelope: {
      contractVersion: SEND_CONTRACT_VERSION,
      conversation,
      content,
      replyTo,
      idempotency
    }
  };
}

function buildMessageDeliveryEvent(value = {}) {
  const eventId = cleanString(value.eventId ?? value.id, 160);
  const messageId = cleanString(value.messageId, 160);
  const conversation = normalizeConversation(value.conversation);
  const type = DELIVERY_EVENT_TYPES.includes(value.type) ? value.type : '';
  if (!eventId || !messageId || !conversation || !type) return null;

  return {
    contractVersion: SEND_CONTRACT_VERSION,
    eventId,
    type,
    conversation,
    messageId,
    cursor: typeof value.cursor === 'string' && value.cursor ? value.cursor : undefined,
    message: isObject(value.message) ? value.message : undefined
  };
}

module.exports = {
  DELIVERY_EVENT_TYPES,
  IDEMPOTENCY_FINGERPRINT_MAX_LENGTH,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  REPLY_PREVIEW_TEXT_MAX_LENGTH,
  SEND_CONTRACT_VERSION,
  buildMessageDeliveryEvent,
  isSystemCard,
  normalizeConversation,
  normalizeIdempotency,
  normalizeReplyPointer,
  normalizeReplyPreview,
  normalizeSendEnvelope
};
