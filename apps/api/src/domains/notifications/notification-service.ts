import type pg from 'pg';
import { transaction } from '../../lib/db.js';
import {
  buildNotificationEnvelope,
  buildProviderPayload,
  normalizeNotificationLevel,
  normalizeNotificationLimit,
  type NotificationEnvelope,
  type NotificationLevel
} from '@voice-room/shared/notifications';
import type { CursorTuple, InboxNotification, InboxRepository } from './inbox-repository.ts';
import type { MentionEligibilityService } from './mention-eligibility-service.ts';
import type { MentionRepository } from './mention-repository.ts';
import type { NotificationOutboxRepository } from './notification-outbox-repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;

export interface InboxCursorCodec {
  encode(input: { purpose: string; context: string; tuple: CursorTuple }): string;
  decode(cursor: string, options: { purpose: string; context: string }): CursorTuple;
}

export interface RoomLevelStore {
  getRoomLevel?(input: { userId: string; roomId: string }): Promise<NotificationLevel> | NotificationLevel;
  setRoomLevel?(input: { userId: string; roomId: string; level: NotificationLevel }): unknown;
  getPreferences?(userId: string): Promise<{ roomLevels?: Record<string, NotificationLevel>; mutedRoomIds?: string[] } | null | undefined>;
}

type Unread = { count: number; revision: number };

function createNotificationService({ pool, inbox, mentions, eligibility, outbox, cursorCodec, notificationStore }: {
  pool?: pg.Pool | null;
  inbox?: InboxRepository;
  mentions?: MentionRepository;
  eligibility?: MentionEligibilityService;
  outbox?: NotificationOutboxRepository;
  cursorCodec?: InboxCursorCodec;
  notificationStore?: RoomLevelStore | null;
} = {}) {
  if (!pool?.query || !inbox) throw new TypeError('Notification service requires pool and inbox repository');
  const db = pool;
  const items = inbox;
  const encode = (item: InboxNotification): string | undefined =>
    cursorCodec?.encode({ purpose: 'notification-inbox', context: item.recipientUserId, tuple: item.cursorTuple });

  async function list({ userId, cursor, limit }: { userId: string; cursor?: string; limit?: unknown }): Promise<NotificationEnvelope> {
    const pageSize = normalizeNotificationLimit(limit);
    const before = cursor ? cursorCodec!.decode(cursor, { purpose: 'notification-inbox', context: userId }) : null;
    const [rows, unread, firstUnread] = await Promise.all([
      items.list({ recipientUserId: userId, limit: pageSize, before }),
      items.unreadCount(userId),
      items.findFirstUnread?.(userId)
    ]);
    const hasMore = rows.length > pageSize;
    const visible = hasMore ? rows.slice(0, pageSize) : rows;
    const page = visible.map((row) => ({ ...row, cursor: encode(row), body: row.retractedAt ? '' : row.body }));
    return buildNotificationEnvelope({
      notifications: page,
      nextCursor: hasMore ? encode(visible.at(-1)!) : undefined,
      hasMore,
      unreadCount: unread.count,
      revision: unread.revision,
      firstUnread: firstUnread ? { ...firstUnread, cursor: encode(firstUnread) } : null
    });
  }

  async function count(userId: string): Promise<Unread> { return items.unreadCount(userId); }

  async function markRead({ userId, notificationId }: { userId: string; notificationId: string }) {
    const item = await items.markRead({ recipientUserId: userId, notificationId });
    if (!item) return { ok: false as const, code: 'not_found' };
    const unread = await items.unreadCount(userId);
    return { ok: true as const, notification: item, unreadCount: unread.count, revision: unread.revision };
  }

  async function markAllRead({ userId, through }: { userId: string; through?: unknown }) {
    const result: number | { updated: number | null; revision: number | null } = await items.markAllRead({ recipientUserId: userId, through });
    const unread = await items.unreadCount(userId);
    return {
      ok: true as const,
      updated: typeof result === 'number' ? result : result.updated,
      unreadCount: unread.count,
      revision: Math.max(unread.revision, Number((result as { revision?: unknown })?.revision) || 0)
    };
  }

  async function markRoomRead({ userId, roomId, through = null }: { userId?: string; roomId?: string; through?: unknown }) {
    if (!userId || !roomId) return { ok: false as const, code: 'invalid_request' };
    const result = await items.markReadForRoom({ recipientUserId: userId, roomId, through });
    const unread = await items.unreadCount(userId);
    return {
      ok: true as const,
      updated: result?.updated || 0,
      unreadCount: unread.count,
      revision: Math.max(unread.revision, Number(result?.revision) || 0)
    };
  }

  async function resync(userId: string) {
    const unread = await items.unreadCount(userId);
    return { ok: true as const, unreadCount: unread.count, revision: unread.revision };
  }

  async function createAddressedForMessage({ roomId, messageId, creatorUserId, targetUserIds = [], replyTargetUserId = null, body = '', client }: {
    roomId: string;
    messageId: string;
    creatorUserId: string;
    targetUserIds?: unknown;
    replyTargetUserId?: string | null;
    body?: string;
    client?: QueryClient | null;
  }): Promise<InboxNotification[]> {
    const run = async (tx: QueryClient): Promise<InboxNotification[]> => {
      const eligible = await eligibility!.validate({ roomId, creatorUserId, targetUserIds, client: tx });
      await mentions!.replaceForMessage({ roomId, messageId, creatorUserId, targetUserIds: eligible, client: tx });
      const recipientReasons = new Map<string, Set<string>>();
      for (const userId of eligible) recipientReasons.set(userId, new Set(['mention']));
      if (replyTargetUserId && replyTargetUserId !== creatorUserId) {
        const reasons = recipientReasons.get(replyTargetUserId) || new Set<string>();
        reasons.add('reply');
        recipientReasons.set(replyTargetUserId, reasons);
      }
      const created: InboxNotification[] = [];
      for (const [recipientUserId, reasons] of recipientReasons) {
        // upsert always returns the row it wrote.
        const item = (await items.upsert({ recipientUserId, actorUserId: creatorUserId, roomId, sourceMessageId: messageId, reasons: [...reasons], body, client: tx }))!;
        const payload = buildProviderPayload(item);
        await outbox!.enqueue({ notificationId: item.id, recipientUserId, revision: item.revision, payload, client: tx });
        created.push(item);
      }
      return created;
    };
    return client ? run(client) : transaction(db, run);
  }

  async function getRoomLevel({ userId, roomId }: { userId: string; roomId: string }): Promise<NotificationLevel> {
    if (notificationStore?.getRoomLevel) return notificationStore.getRoomLevel({ userId, roomId });
    const prefs = await notificationStore?.getPreferences?.(userId);
    if (prefs?.roomLevels?.[roomId]) return prefs.roomLevels[roomId];
    return prefs?.mutedRoomIds?.includes(roomId) ? 'none' : 'mentions';
  }

  async function setRoomLevel({ userId, roomId, level }: { userId: string; roomId: string; level: unknown }) {
    const normalized = normalizeNotificationLevel(level, '' as NotificationLevel);
    if (!normalized) return { ok: false, code: 'invalid_level' };
    if (notificationStore?.setRoomLevel) return notificationStore.setRoomLevel({ userId, roomId, level: normalized });
    return { ok: false, code: 'not_supported' };
  }

  return { count, createAddressedForMessage, getRoomLevel, list, markAllRead, markRead, markRoomRead, resync, setRoomLevel };
}

export type NotificationService = ReturnType<typeof createNotificationService>;

export { createNotificationService };
