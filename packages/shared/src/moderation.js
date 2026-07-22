'use strict';

const MODERATION_CONTRACT_VERSION = 1;
const MODERATION_DEFAULT_LIMIT = 50;
const MODERATION_MAX_LIMIT = 100;
const MODERATION_REASON_MAX_LENGTH = 500;
const MODERATION_DURATIONS = Object.freeze(['1h', '1d', '7d', 'permanent']);
const MODERATION_DURATION_MS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  permanent: null
});

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

function normalizeModerationLimit(value, fallback = MODERATION_DEFAULT_LIMIT) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, MODERATION_MAX_LIMIT);
}

function normalizeBanDuration(value) {
  return MODERATION_DURATIONS.includes(value) ? value : null;
}

function durationToExpiresAt(duration, now = Date.now()) {
  const normalized = normalizeBanDuration(duration);
  if (!normalized) return undefined;
  const delta = MODERATION_DURATION_MS[normalized];
  return delta == null ? null : Number(now) + delta;
}

function normalizeBanMutation(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const userId = cleanString(value.userId, 36);
  const guestIp = userId ? '' : cleanString(value.guestIp, 256);
  const duration = normalizeBanDuration(value.duration);
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if ((!userId && !guestIp) || !duration || reason.length > MODERATION_REASON_MAX_LENGTH) return null;
  return { userId: userId || null, guestIp: guestIp || null, duration, reason };
}

function normalizeIdempotencyKey(value) {
  return cleanString(value, 128) || null;
}

function normalizeModerationPageRequest(value = {}) {
  return {
    cursor: cleanString(value.cursor, 4096) || undefined,
    limit: normalizeModerationLimit(value.limit)
  };
}

function normalizeActiveBan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = cleanString(value.id, 36);
  const roomId = cleanString(value.roomId, 48);
  const userId = cleanString(value.subject?.userId ?? value.userId, 36) || null;
  const kind = userId ? 'account' : 'guest';
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt ?? value.createdAt);
  const expiresAt = value.expiresAt == null ? null : Number(value.expiresAt);
  if (!id || !roomId || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  if (expiresAt != null && !Number.isFinite(expiresAt)) return null;
  return {
    id,
    roomId,
    subject: { kind, userId },
    reason: typeof value.reason === 'string' ? value.reason.slice(0, MODERATION_REASON_MAX_LENGTH) : '',
    createdAt,
    updatedAt,
    expiresAt
  };
}

function buildModerationPage({ roomId, bans = [], nextCursor, hasMore = false } = {}) {
  return {
    contractVersion: MODERATION_CONTRACT_VERSION,
    roomId: cleanString(roomId, 48),
    bans: Array.isArray(bans) ? bans.map(normalizeActiveBan).filter(Boolean) : [],
    pageInfo: {
      nextCursor: cleanString(nextCursor, 4096) || undefined,
      hasMore: Boolean(hasMore)
    }
  };
}

module.exports = {
  MODERATION_CONTRACT_VERSION,
  MODERATION_DEFAULT_LIMIT,
  MODERATION_MAX_LIMIT,
  MODERATION_REASON_MAX_LENGTH,
  MODERATION_DURATIONS,
  MODERATION_DURATION_MS,
  buildModerationPage,
  durationToExpiresAt,
  normalizeActiveBan,
  normalizeBanDuration,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationLimit,
  normalizeModerationPageRequest
};
