export const NOTIFICATION_CONTRACT_VERSION: 1;
export const NOTIFICATION_DEFAULT_LIMIT: 50;
export const NOTIFICATION_MAX_LIMIT: 100;
export const NOTIFICATION_LEVELS: readonly ['all', 'mentions', 'none'];
export const NOTIFICATION_REASONS: readonly ['mention', 'reply'];
export type NotificationLevel = 'all' | 'mentions' | 'none';
export type NotificationReason = 'mention' | 'reply';
export interface NotificationItem { id: string; roomId: string; sourceMessageId: string; actorUserId: string; reasons: NotificationReason[]; revision: number; createdAt: unknown; updatedAt: unknown; readAt: unknown; retractedAt: unknown; body: string; cursor?: string }
export interface NotificationEnvelope { contractVersion: 1; notifications: NotificationItem[]; pageInfo: { nextCursor?: string; hasMore: boolean }; unreadCount: number; revision: number }
export function normalizeNotificationLevel(value: unknown, fallback?: NotificationLevel): NotificationLevel;
export function normalizeNotificationLimit(value: unknown, fallback?: number): number;
export function normalizeNotificationItem(value: unknown): NotificationItem | null;
export function buildNotificationEnvelope(value?: Partial<NotificationEnvelope> & { nextCursor?: string; hasMore?: boolean }): NotificationEnvelope;
export function normalizeNotificationEnvelope(value: unknown): { ok: true; envelope: NotificationEnvelope } | { ok: false; code: string };
export function buildProviderPayload(value: unknown, options?: { privateNotifications?: boolean }): { contractVersion: 1; notificationId: string; revision: number; dedupeKey: string; title: string; body: string; route: string } | null;
