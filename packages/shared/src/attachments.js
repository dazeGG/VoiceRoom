'use strict';

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STATES = new Set(['pending', 'processing', 'ready', 'failed', 'deleted']);

function text(value, max = 128) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= max ? normalized : '';
}

function normalizeAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id);
  const context = value.context === 'room' || value.context === 'dm' ? value.context : '';
  const ownerId = text(value.ownerId);
  const mimeType = MIME_TYPES.has(value.mimeType) ? value.mimeType : '';
  const state = STATES.has(value.state) ? value.state : 'unavailable';
  const order = Number(value.order);
  const bytes = Number(value.bytes);
  const width = Number(value.width);
  const height = Number(value.height);
  if (!id || !context || !ownerId || !mimeType) return null;
  if (!Number.isSafeInteger(order) || order < 0 || order >= MAX_ATTACHMENTS) return null;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ATTACHMENT_BYTES) return null;
  if (!Number.isSafeInteger(width) || width < 1 || width > 16_384) return null;
  if (!Number.isSafeInteger(height) || height < 1 || height > 16_384) return null;
  return {
    id,
    context,
    ownerId,
    order,
    mimeType,
    bytes,
    width,
    height,
    state,
    url: state === 'ready' && typeof value.url === 'string' ? value.url : null
  };
}

function normalizeAttachments(values) {
  if (!Array.isArray(values) || values.length > MAX_ATTACHMENTS) return null;
  const attachments = values.map(normalizeAttachment);
  if (attachments.some((attachment) => !attachment)) return null;
  const orders = new Set(attachments.map((attachment) => attachment.order));
  return orders.size === attachments.length ? attachments : null;
}

function attachmentTextFallback(values, fallback = '') {
  const attachments = normalizeAttachments(values);
  if (!attachments?.length) return String(fallback || '');
  return String(fallback || '').trim() || `[Изображения: ${attachments.length}]`;
}

module.exports = {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  attachmentTextFallback,
  normalizeAttachment,
  normalizeAttachments
};
