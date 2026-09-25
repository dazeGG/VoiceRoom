// Mention and reply notifications: the per-room level, the inbox envelope,
// where a notification takes you, and the payload a push provider sends.

export const NOTIFICATION_CONTRACT_VERSION = 1 as const;
export const NOTIFICATION_DEFAULT_LIMIT = 50 as const;
export const NOTIFICATION_MAX_LIMIT = 100 as const;
export const NOTIFICATION_LEVELS: readonly ['all', 'mentions', 'none'] = Object.freeze([
  'all',
  'mentions',
  'none'
] as const);
export const NOTIFICATION_REASONS: readonly ['mention', 'reply'] = Object.freeze(['mention', 'reply'] as const);

export type NotificationLevel = 'all' | 'mentions' | 'none';
export type NotificationReason = 'mention' | 'reply';
export interface NotificationItem {
  id: string;
  roomId: string;
  sourceMessageId: string;
  actorUserId: string;
  reasons: NotificationReason[];
  revision: number;
  createdAt: unknown;
  updatedAt: unknown;
  readAt: unknown;
  retractedAt: unknown;
  body: string;
  cursor?: string;
}
export interface NotificationEnvelope {
  contractVersion: 1;
  notifications: NotificationItem[];
  pageInfo: { nextCursor?: string; hasMore: boolean };
  unreadCount: number;
  revision: number;
  firstUnread: NotificationItem | null;
}
export type ProviderPayload = {
  contractVersion: 1;
  notificationId: string;
  revision: number;
  dedupeKey: string;
  title: string;
  body: string;
  route: string;
};

type Loose = Record<string, unknown>;

const NOTIFICATION_LEVEL_SET = new Set<unknown>(NOTIFICATION_LEVELS);
const NOTIFICATION_REASON_SET = new Set<unknown>(NOTIFICATION_REASONS);

function cleanString(value: unknown, max = 256): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= max ? text : '';
}

export function normalizeNotificationLevel(
  value: unknown,
  fallback: NotificationLevel = 'mentions'
): NotificationLevel {
  return NOTIFICATION_LEVEL_SET.has(value) ? (value as NotificationLevel) : fallback;
}

export function normalizeNotificationLimit(value: unknown, fallback: number = NOTIFICATION_DEFAULT_LIMIT): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, NOTIFICATION_MAX_LIMIT) : fallback;
}

export function normalizeNotificationItem(input: unknown): NotificationItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Loose;
  const id = cleanString(value.id ?? value.notificationId, 160);
  const roomId = cleanString(value.roomId, 48);
  const sourceMessageId = cleanString(value.sourceMessageId ?? value.messageId, 160);
  const actorUserId = cleanString(value.actorUserId, 36);
  const reasons = Array.isArray(value.reasons)
    ? [...new Set(value.reasons.filter((reason): reason is NotificationReason => NOTIFICATION_REASON_SET.has(reason)))]
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

export function buildNotificationEnvelope({
  notifications = [],
  nextCursor,
  hasMore = false,
  unreadCount = 0,
  revision = 0,
  firstUnread = null
}: {
  notifications?: unknown;
  nextCursor?: unknown;
  hasMore?: unknown;
  unreadCount?: unknown;
  revision?: unknown;
  firstUnread?: unknown;
} = {}): NotificationEnvelope {
  return {
    contractVersion: NOTIFICATION_CONTRACT_VERSION,
    notifications: Array.isArray(notifications)
      ? notifications.map(normalizeNotificationItem).filter((item): item is NotificationItem => Boolean(item))
      : [],
    pageInfo: { nextCursor: cleanString(nextCursor, 4096) || undefined, hasMore: Boolean(hasMore) },
    unreadCount: Math.max(0, Number.isSafeInteger(Number(unreadCount)) ? Number(unreadCount) : 0),
    revision: Math.max(0, Number.isSafeInteger(Number(revision)) ? Number(revision) : 0),
    firstUnread: normalizeNotificationItem(firstUnread)
  };
}

export function normalizeNotificationEnvelope(
  input: unknown
): { ok: true; envelope: NotificationEnvelope } | { ok: false; code: string } {
  const value = input as Loose | null;
  if (!value || typeof value !== 'object' || value.contractVersion !== NOTIFICATION_CONTRACT_VERSION) {
    return { ok: false, code: 'invalid_notification_envelope' };
  }
  const pageInfo = value.pageInfo as Loose | null | undefined;
  return {
    ok: true,
    envelope: buildNotificationEnvelope({
      notifications: value.notifications,
      nextCursor: pageInfo?.nextCursor,
      hasMore: pageInfo?.hasMore,
      unreadCount: value.unreadCount,
      revision: value.revision,
      firstUnread: value.firstUnread
    })
  };
}

/**
 * Where a notification takes you: the room's lobby preview with its chat open
 * on the source message. Deliberately not /r/:roomId — that route means "put me
 * back inside this room" and joins voice on load, which a mention must never do.
 */
export function notificationRoute(
  item: Partial<Pick<NotificationItem, 'roomId' | 'sourceMessageId'>> | null | undefined
): string {
  const roomId = encodeURIComponent(String(item?.roomId || ''));
  const messageId = encodeURIComponent(String(item?.sourceMessageId || ''));
  return `/?room=${roomId}&message=${messageId}`;
}

export function buildProviderPayload(
  item: unknown,
  { privateNotifications = false }: { privateNotifications?: boolean } = {}
): ProviderPayload | null {
  const notification = normalizeNotificationItem(item);
  if (!notification) return null;
  return {
    contractVersion: NOTIFICATION_CONTRACT_VERSION,
    notificationId: notification.id,
    revision: notification.revision,
    dedupeKey: `${notification.id}:${notification.revision}`,
    title: 'VoiceRoom',
    body: privateNotifications
      ? 'Откройте VoiceRoom, чтобы посмотреть уведомление.'
      : notification.body || 'У вас новое уведомление',
    route: notificationRoute(notification)
  };
}
