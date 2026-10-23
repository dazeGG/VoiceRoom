// Mention and reply notifications: the per-room level, building the inbox
// page (its shape is contracts/notifications.ts), where a notification takes
// you, and the payload a push provider sends.

import type { InboxItem, InboxPage, NotificationLevel, NotificationReason } from './contracts/notifications.ts';
import { isArray, isOneOf, isRecord, pageInfoOf, trimmedText } from './guards.ts';

const NOTIFICATION_CONTRACT_VERSION = 1 as const;
export const NOTIFICATION_DEFAULT_LIMIT = 50 as const;
export const NOTIFICATION_MAX_LIMIT = 100 as const;
export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = Object.freeze(['all', 'mentions', 'none'] as const);
export const NOTIFICATION_REASONS: readonly NotificationReason[] = Object.freeze(['mention', 'reply'] as const);

/** What a Web Push carries: every API push sends it, the service worker reads it. */
export type PushPayload = {
  title?: string | undefined;
  body?: string | undefined;
  tag?: string | undefined;
  /** The same-site path a click on the notification opens. */
  url?: string | undefined;
  dedupeKey?: string | undefined;
  notificationId?: string | undefined;
  revision?: number | undefined;
  type?: string | undefined;
  /** Epoch milliseconds; the service worker drops the push after it. */
  expiresAt?: number | undefined;
};
/** The mention/reply push the notification outbox queues. */
export type ProviderPayload = Required<
  Pick<PushPayload, 'notificationId' | 'revision' | 'dedupeKey' | 'title' | 'body' | 'url'>
> & { contractVersion: 1 };

// Rows carry what the database driver returns (a Date, an ISO string or a number).
function epochMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNotificationLimit(value: unknown, fallback: number = NOTIFICATION_DEFAULT_LIMIT): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, NOTIFICATION_MAX_LIMIT) : fallback;
}

export function normalizeNotificationItem(input: unknown): InboxItem | null {
  if (!isRecord(input)) return null;
  const value = input;
  const id = trimmedText(value.id ?? value.notificationId, 160);
  const roomId = trimmedText(value.roomId, 48);
  const sourceMessageId = trimmedText(value.sourceMessageId ?? value.messageId, 160);
  const actorUserId = trimmedText(value.actorUserId, 36);
  const reasons = isArray(value.reasons)
    ? [...new Set(value.reasons.filter((reason) => isOneOf(NOTIFICATION_REASONS, reason)))]
    : [];
  if (!id || !roomId || !sourceMessageId || !actorUserId || reasons.length === 0) return null;
  const cursor = trimmedText(value.cursor, 4096);
  return {
    id,
    roomId,
    sourceMessageId,
    actorUserId,
    reasons,
    revision: Math.max(1, Number.isSafeInteger(Number(value.revision)) ? Number(value.revision) : 1),
    createdAt: epochMillis(value.createdAt),
    updatedAt: epochMillis(value.updatedAt),
    readAt: epochMillis(value.readAt),
    retractedAt: epochMillis(value.retractedAt),
    body: value.retractedAt ? '' : trimmedText(value.body, 512),
    ...(cursor ? { cursor } : {})
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
} = {}): InboxPage {
  return {
    contractVersion: NOTIFICATION_CONTRACT_VERSION,
    notifications: isArray(notifications)
      ? notifications.map(normalizeNotificationItem).filter((item): item is InboxItem => Boolean(item))
      : [],
    pageInfo: pageInfoOf(nextCursor, hasMore),
    unreadCount: Math.max(0, Number.isSafeInteger(Number(unreadCount)) ? Number(unreadCount) : 0),
    revision: Math.max(0, Number.isSafeInteger(Number(revision)) ? Number(revision) : 0),
    firstUnread: normalizeNotificationItem(firstUnread)
  };
}

/**
 * Where a notification takes you: the room's lobby preview with its chat open
 * on the source message. Deliberately not /r/:roomId — that route means "put me
 * back inside this room" and joins voice on load, which a mention must never do.
 */
export function notificationRoute(
  item: Partial<Pick<InboxItem, 'roomId' | 'sourceMessageId'>> | null | undefined
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
    url: notificationRoute(notification)
  };
}

/** Reads a received push, keeping only the fields of `PushPayload` that have its types. */
export function parsePushPayload(input: unknown): PushPayload {
  if (!input || typeof input !== 'object') return {};
  const fields = new Map<string, unknown>(Object.entries(input));
  const text = (key: string): string | undefined => {
    const value = fields.get(key);
    return typeof value === 'string' ? value : undefined;
  };
  const finite = (key: string): number | undefined => {
    const value = fields.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  return {
    title: text('title'),
    body: text('body'),
    tag: text('tag'),
    // Mention/reply pushes queued in the outbox before 2.10.2 name it `route`.
    url: text('url') ?? text('route'),
    dedupeKey: text('dedupeKey'),
    notificationId: text('notificationId'),
    revision: finite('revision'),
    type: text('type'),
    expiresAt: finite('expiresAt')
  };
}
