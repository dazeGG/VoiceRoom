import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { fromMicros, microsOf } from '../../platform/db/micros.ts';
import { normalizeLinkPreview, type LinkPreview } from '@voice-room/shared/link-preview';
import { normalizeRoomMessageContent, type RoomMessageContentV1 } from '@voice-room/shared/room-message-content';

type Anchor = { createdAtMicros: unknown; id: string };
type Direction = 'before' | 'after' | 'at-or-after';

type RoomMessageRow = {
  id: string;
  room_id: string;
  peer_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  text: string | null;
  content: unknown;
  created_at: Date | string;
  created_at_micros: string;
  edited_at: unknown;
  expires_at: unknown;
  avatar_color_key: string | null;
  avatar_key: string | null;
  avatar_accent: string | null;
  metadata: { linkPreview?: unknown } | null;
  reply_to_message_id: string | null;
};

export type HistoryRoomMessage = {
  id: string;
  roomId: string;
  peerId: string;
  authorUserId: string | null;
  name: string;
  text: string;
  content: RoomMessageContentV1 | undefined;
  createdAt: string;
  createdAtMicros: string;
  editedAt: unknown;
  expiresAt: unknown;
  avatarColorKey: string | null;
  avatarKey: string | null;
  avatarAccent: string | null;
  linkPreview: LinkPreview | undefined;
  replyTo: { messageId: string } | undefined;
};

type Page = { messages: HistoryRoomMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type SideInput = { roomId: string; anchor: Anchor; limit?: unknown; now: unknown };

function boundedLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number.isInteger(value) ? (value as number) : 50));
}

const COMPARE = { before: '<', after: '>', 'at-or-after': '>=' } as const;

// Room messages with the author's current profile, or the guest identity's colour.
function roomMessages(db: Database, roomId: string, now: unknown) {
  return db
    .selectFrom('room_messages as m')
    .leftJoin('room_peer_identities as rpi', (join) =>
      join.onRef('rpi.room_id', '=', 'm.room_id').onRef('rpi.peer_id', '=', 'm.peer_id')
    )
    .leftJoin('users as u', 'u.id', 'm.author_user_id')
    .selectAll('m')
    .select([
      microsOf('m.created_at').as('created_at_micros'),
      sql<string | null>`COALESCE(NULLIF(u.display_name, ''), u.login, m.name)`.as('author_name'),
      sql<string | null>`COALESCE(u.avatar_color_key, rpi.avatar_color_key)`.as('avatar_color_key'),
      'u.avatar_key',
      'u.avatar_accent'
    ])
    .where('m.room_id', '=', roomId)
    .where('m.deleted_at', 'is', null)
    .where((eb) => eb.or([eb('m.expires_at', 'is', null), eb('m.expires_at', '>', now as Date)]));
}

function mapRoomMessage(row: RoomMessageRow): HistoryRoomMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    peerId: row.peer_id || '',
    authorUserId: row.author_user_id || null,
    name: row.author_name || '',
    text: row.text || '',
    content: normalizeRoomMessageContent(row.content) ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdAtMicros: row.created_at_micros,
    editedAt: row.edited_at || null,
    expiresAt: row.expires_at || null,
    avatarColorKey: row.avatar_color_key || null,
    avatarKey: row.avatar_key || null,
    avatarAccent: row.avatar_accent || null,
    linkPreview: normalizeLinkPreview(row.metadata?.linkPreview) || undefined,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function createRoomHistoryRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const toMessages = (rows: unknown[]) => rows.map((row) => mapRoomMessage(row as RoomMessageRow));

  async function roomExists(roomId: string): Promise<boolean> {
    const row = await db
      .selectFrom('rooms')
      .select('id')
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function getAnchor({ roomId, messageId }: { roomId: string; messageId: string }): Promise<Anchor | null> {
    const row = await db
      .selectFrom('room_messages')
      .select(['id', microsOf('created_at').as('created_at_micros')])
      .where('room_id', '=', roomId)
      .where('id', '=', messageId)
      .limit(1)
      .executeTakeFirst();
    return row ? { id: row.id, createdAtMicros: row.created_at_micros } : null;
  }

  // The page on one side of the anchor, nearest first.
  async function querySide({
    roomId,
    anchor,
    direction,
    limit,
    now
  }: SideInput & { direction: Direction; limit: number }): Promise<HistoryRoomMessage[]> {
    const order = direction === 'before' ? 'desc' : 'asc';
    const rows = await roomMessages(db, roomId, now)
      .where(
        sql<boolean>`(m.created_at, m.id) ${sql.raw(COMPARE[direction])} (${fromMicros(anchor.createdAtMicros)}, ${anchor.id})`
      )
      .orderBy('m.created_at', order)
      .orderBy('m.id', order)
      .limit(limit)
      .execute();
    return toMessages(rows);
  }

  async function listLatest({ roomId, limit, now }: { roomId: string; limit?: unknown; now: unknown }): Promise<Page> {
    const found = await roomMessages(db, roomId, now)
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .limit(boundedLimit(limit) + 1)
      .execute();
    const rows = toMessages(found);
    const hasMoreBefore = rows.length > boundedLimit(limit);
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: false };
  }

  async function listBefore({ roomId, anchor, limit, now }: SideInput): Promise<Page> {
    const size = boundedLimit(limit);
    const rows = await querySide({ roomId, anchor, direction: 'before', limit: size + 1, now });
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: true };
  }

  async function listAfter({ roomId, anchor, limit, now }: SideInput): Promise<Page> {
    const size = boundedLimit(limit);
    const rows = await querySide({ roomId, anchor, direction: 'after', limit: size + 1, now });
    const hasMoreAfter = rows.length > size;
    if (hasMoreAfter) rows.pop();
    return { messages: rows, hasMoreBefore: true, hasMoreAfter };
  }

  async function listAround({ roomId, anchor, limit, now }: SideInput): Promise<Page> {
    const size = boundedLimit(limit);
    const beforeSize = Math.floor(size / 2);
    const afterSize = size - beforeSize;
    let before = await querySide({ roomId, anchor, direction: 'before', limit: beforeSize + 1, now });
    let after = await querySide({ roomId, anchor, direction: 'at-or-after', limit: afterSize + 1, now });
    let hasMoreBefore = before.length > beforeSize;
    let hasMoreAfter = after.length > afterSize;
    if (hasMoreBefore) before.pop();
    if (hasMoreAfter) after.pop();

    if (before.length < beforeSize && hasMoreAfter) {
      const wanted = size - before.length;
      after = await querySide({ roomId, anchor, direction: 'at-or-after', limit: wanted + 1, now });
      hasMoreAfter = after.length > wanted;
      if (hasMoreAfter) after.pop();
    } else if (after.length < afterSize && hasMoreBefore) {
      const wanted = size - after.length;
      before = await querySide({ roomId, anchor, direction: 'before', limit: wanted + 1, now });
      hasMoreBefore = before.length > wanted;
      if (hasMoreBefore) before.pop();
    }

    before.reverse();
    return { messages: [...before, ...after], hasMoreBefore, hasMoreAfter };
  }

  return { getAnchor, listAfter, listAround, listBefore, listLatest, roomExists };
}

export { createRoomHistoryRepository, mapRoomMessage };
