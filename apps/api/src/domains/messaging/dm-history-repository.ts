import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { fromMicros, microsOf } from '../../platform/db/micros.ts';

type Anchor = { createdAtMicros: unknown; id: string };
type Direction = 'before' | 'after' | 'at-or-after';

type DirectMessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string | null;
  created_at: Date | string;
  created_at_micros: string;
  edited_at: unknown;
  read_at: unknown;
  metadata: Record<string, unknown> | null;
  reply_to_message_id: string | null;
};

export type HistoryDirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  createdAtMicros: string;
  editedAt: unknown;
  readAt: unknown;
  metadata: Record<string, unknown>;
  replyTo: { messageId: string } | undefined;
};

type Page = { messages: HistoryDirectMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };

function boundedLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number.isInteger(value) ? (value as number) : 50));
}

const COMPARE = { before: '<', after: '>', 'at-or-after': '>=' } as const;

// Each direction of the thread is read on its own index, then merged: at most
// `limit` from each side, `limit` in all.
async function threadPage(
  db: Database,
  {
    userId,
    peerId,
    limit,
    order,
    anchor
  }: {
    userId: string;
    peerId: string;
    limit: number;
    order: 'asc' | 'desc';
    anchor?: { anchor: Anchor; direction: Direction };
  }
) {
  const side = (from: string, to: string, alias: 'sent' | 'received') => {
    let query = db
      .selectFrom('direct_messages as m')
      .selectAll('m')
      .where('m.sender_id', '=', from)
      .where('m.recipient_id', '=', to)
      .where('m.deleted_at', 'is', null);
    if (anchor) {
      query = query.where(
        sql<boolean>`(m.created_at, m.id) ${sql.raw(COMPARE[anchor.direction])} (${fromMicros(anchor.anchor.createdAtMicros)}, ${anchor.anchor.id})`
      );
    }
    return db
      .selectFrom(query.orderBy('m.created_at', order).orderBy('m.id', order).limit(limit).as(alias))
      .selectAll();
  };
  return db
    .selectFrom(
      side(userId, peerId, 'sent')
        .unionAll(side(peerId, userId, 'received'))
        .as('thread')
    )
    .selectAll()
    .select(microsOf('thread.created_at').as('created_at_micros'))
    .orderBy('thread.created_at', order)
    .orderBy('thread.id', order)
    .limit(limit)
    .execute();
}

function mapDirectMessage(row: DirectMessageRow): HistoryDirectMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdAtMicros: row.created_at_micros,
    editedAt: row.edited_at || null,
    readAt: row.read_at || null,
    metadata: row.metadata || {},
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function createDmHistoryRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const toMessages = (rows: unknown[]) => rows.map((row) => mapDirectMessage(row as DirectMessageRow));

  async function canReadThread({ userId, peerId }: { userId: string; peerId: string }): Promise<boolean> {
    if (!userId || !peerId || userId === peerId) return false;
    const [low, high] = userId < peerId ? [userId, peerId] : [peerId, userId];
    const row = await db
      .selectFrom('friendships')
      .select('id')
      .where('user_a_id', '=', low)
      .where('user_b_id', '=', high)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function querySide({
    userId,
    peerId,
    anchor,
    direction,
    limit
  }: {
    userId: string;
    peerId: string;
    anchor: Anchor;
    direction: Direction;
    limit: number;
  }): Promise<HistoryDirectMessage[]> {
    const order = direction === 'before' ? 'desc' : 'asc';
    return toMessages(await threadPage(db, { userId, peerId, limit, order, anchor: { anchor, direction } }));
  }

  async function listLatest({
    userId,
    peerId,
    limit
  }: {
    userId: string;
    peerId: string;
    limit?: unknown;
  }): Promise<Page> {
    const size = boundedLimit(limit);
    const rows = toMessages(await threadPage(db, { userId, peerId, limit: size + 1, order: 'desc' }));
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: false };
  }

  async function listBefore({
    userId,
    peerId,
    anchor,
    limit
  }: {
    userId: string;
    peerId: string;
    anchor: Anchor;
    limit?: unknown;
  }): Promise<Page> {
    const size = boundedLimit(limit);
    const rows = await querySide({ userId, peerId, anchor, direction: 'before', limit: size + 1 });
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: true };
  }

  async function listAfter({
    userId,
    peerId,
    anchor,
    limit
  }: {
    userId: string;
    peerId: string;
    anchor: Anchor;
    limit?: unknown;
  }): Promise<Page> {
    const size = boundedLimit(limit);
    const rows = await querySide({ userId, peerId, anchor, direction: 'after', limit: size + 1 });
    const hasMoreAfter = rows.length > size;
    if (hasMoreAfter) rows.pop();
    return { messages: rows, hasMoreBefore: true, hasMoreAfter };
  }

  async function listAround({
    userId,
    peerId,
    anchor,
    limit
  }: {
    userId: string;
    peerId: string;
    anchor: Anchor;
    limit?: unknown;
  }): Promise<Page> {
    const size = boundedLimit(limit);
    const beforeSize = Math.floor(size / 2);
    const afterSize = size - beforeSize;
    let before = await querySide({ userId, peerId, anchor, direction: 'before', limit: beforeSize + 1 });
    let after = await querySide({ userId, peerId, anchor, direction: 'at-or-after', limit: afterSize + 1 });
    let hasMoreBefore = before.length > beforeSize;
    let hasMoreAfter = after.length > afterSize;
    if (hasMoreBefore) before.pop();
    if (hasMoreAfter) after.pop();

    if (before.length < beforeSize && hasMoreAfter) {
      const wanted = size - before.length;
      after = await querySide({ userId, peerId, anchor, direction: 'at-or-after', limit: wanted + 1 });
      hasMoreAfter = after.length > wanted;
      if (hasMoreAfter) after.pop();
    } else if (after.length < afterSize && hasMoreBefore) {
      const wanted = size - after.length;
      before = await querySide({ userId, peerId, anchor, direction: 'before', limit: wanted + 1 });
      hasMoreBefore = before.length > wanted;
      if (hasMoreBefore) before.pop();
    }

    before.reverse();
    return { messages: [...before, ...after], hasMoreBefore, hasMoreAfter };
  }

  return { canReadThread, listAfter, listAround, listBefore, listLatest };
}

export { createDmHistoryRepository, mapDirectMessage };
