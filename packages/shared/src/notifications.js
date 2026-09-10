'use strict';

const NOTIFICATION_CONTRACT_VERSION = 1;
const NOTIFICATION_DEFAULT_LIMIT = 50;
const NOTIFICATION_MAX_LIMIT = 100;
const NOTIFICATION_LEVELS = Object.freeze(['all', 'mentions', 'none']);
const NOTIFICATION_LEVEL_SET = new Set(NOTIFICATION_LEVELS);
const NOTIFICATION_REASONS = Object.freeze(['mention', 'reply']);
const NOTIFICATION_REASON_SET = new Set(NOTIFICATION_REASONS);

function cleanString(value, max = 256) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= max ? text : '';
}

function normalizeNotificationLevel(value, fallback = 'mentions') {
  return NOTIFICATION_LEVEL_SET.has(value) ? value : fallback;
}

function normalizeNotificationLimit(value, fallback = NOTIFICATION_DEFAULT_LIMIT) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, NOTIFICATION_MAX_LIMIT) : fallback;
}

function normalizeNotificationItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = cleanString(value.id ?? value.notificationId, 160);
  const roomId = cleanString(value.roomId, 48);
  const sourceMessageId = cleanString(value.sourceMessageId ?? value.messageId, 160);
  const actorUserId = cleanString(value.actorUserId, 36);
  const reasons = Array.isArray(value.reasons)
    ? [...new Set(value.reasons.filter((reason) => NOTIFICATION_REASON_SET.has(reason)))]
    : [];
  if (!id || !roomId || !sourceMessageId || !actorUserId || reasons.length === 0) return null;
  return {
    id,
    roomId,
    sourceMessageId,
    actorUserId,
    reasons,
    revision: Math.max(1, Number.isSafeInteger(Number(value.revision)) ? Number(value.revision) : 1),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
    readAt: value.readAt ?? null,
    retractedAt: value.retractedAt ?? null,
    body: value.retractedAt ? '' : cleanString(value.body, 512),
    cursor: cleanString(value.cursor, 4096) || undefined
  };
}

function buildNotificationEnvelope({ notifications = [], nextCursor, hasMore = false, unreadCount = 0, revision = 0, firstUnread = null } = {}) {
  return {
    contractVersion: NOTIFICATION_CONTRACT_VERSION,
    notifications: Array.isArray(notifications) ? notifications.map(normalizeNotificationItem).filter(Boolean) : [],
    pageInfo: { nextCursor: cleanString(nextCursor, 4096) || undefined, hasMore: Boolean(hasMore) },
    unreadCount: Math.max(0, Number.isSafeInteger(Number(unreadCount)) ? Number(unreadCount) : 0),
    revision: Math.max(0, Number.isSafeInteger(Number(revision)) ? Number(revision) : 0),
    firstUnread: normalizeNotificationItem(firstUnread)
  };
}

function normalizeNotificationEnvelope(value) {
  if (!value || typeof value !== 'object' || value.contractVersion !== NOTIFICATION_CONTRACT_VERSION) {
    return { ok: false, code: 'invalid_notification_envelope' };
  }
  return { ok: true, envelope: buildNotificationEnvelope({
    notifications: value.notifications,
    nextCursor: value.pageInfo?.nextCursor,
    hasMore: value.pageInfo?.hasMore,
    unreadCount: value.unreadCount,
    revision: value.revision,
    firstUnread: value.firstUnread
  }) };
}

/**
 * Where a notification takes you: the room's lobby preview with its chat open
 * on the source message. Deliberately not /r/:roomId — that route means "put me
 * back inside this room" and joins voice on load, which a mention must never do.
 */
function notificationRoute(item) {
  const roomId = encodeURIComponent(String(item?.roomId || ''));
  const messageId = encodeURIComponent(String(item?.sourceMessageId || ''));
  return `/?room=${roomId}&message=${messageId}`;
}

function buildProviderPayload(item, { privateNotifications = false } = {}) {
  const notification = normalizeNotificationItem(item);
  if (!notification) return null;
  return {
    contractVersion: NOTIFICATION_CONTRACT_VERSION,
    notificationId: notification.id,
    revision: notification.revision,
    dedupeKey: `${notification.id}:${notification.revision}`,
    title: 'VoiceRoom',
    body: privateNotifications ? 'Open VoiceRoom to view this notification.' : (notification.body || 'You have a new notification'),
    route: notificationRoute(notification)
  };
}

module.exports = {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_LEVELS,
  NOTIFICATION_MAX_LIMIT,
  NOTIFICATION_REASONS,
  buildNotificationEnvelope,
  buildProviderPayload,
  normalizeNotificationEnvelope,
  normalizeNotificationItem,
  normalizeNotificationLevel,
  normalizeNotificationLimit,
  notificationRoute
};
