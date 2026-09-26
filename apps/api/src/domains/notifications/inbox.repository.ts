import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  room_id: string;
  source_message_id: string;
  reasons: string[] | null;
  body: string | null;
  revision: number | string;
  read_at: unknown;
  retracted_at: unknown;
  created_at: Date | string;
  updated_at: unknown;
  created_at_micros?: string | number | null;
};

export type CursorTuple = { createdAtMicros: string; id: string };

export type InboxNotification = {
  id: string;
  recipientUserId: string;
  actorUserId: string;
  roomId: string;
  sourceMessageId: string;
  reasons: string[];
  body: string;
  revision: number;
  readAt: unknown;
  retractedAt: unknown;
  createdAt: Date | string;
  updatedAt: unknown;
  cursorTuple: CursorTuple;
};

export type ReadAllResult = { updated: number | null; revision: number | null };

const createdAtMicros = sql<string>`floor(extract(epoch FROM created_at) * 1000000)::numeric(20,0)`.as(
  'created_at_micros'
);
const now = sql<Date>`current_timestamp`;

// The read point that bounds which notifications a read retires. Callers hand
// over what they have — a Date from a row, epoch milliseconds from the legacy
// room read, an ISO string — and PostgreSQL gets a Date. A bare millisecond
// number reached `::timestamptz` as "1789427934720" and failed the whole read.
// Returns null for "no bound" and undefined for a value that is not a time.
function readBound(through: unknown): Date | null | undefined {
  if (through == null) return null;
  const bound = through instanceof Date ? through : new Date(through as string | number);
  return Number.isNaN(bound.getTime()) ? undefined : bound;
}

function mapRow(row: NotificationRow | null | undefined): InboxNotification | null {
  return row
    ? {
        id: row.id,
        recipientUserId: row.recipient_user_id,
        actorUserId: row.actor_user_id,
        roomId: row.room_id,
        sourceMessageId: row.source_message_id,
        reasons: row.reasons || [],
        body: row.body || '',
        revision: Number(row.revision),
        readAt: row.read_at,
        retractedAt: row.retracted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        cursorTuple: {
          createdAtMicros: String(row.created_at_micros || Math.trunc(new Date(row.created_at).getTime() * 1000)),
          id: row.id
        }
      }
    : null;
}

function createInboxRepository({ pool }: { pool?: pg.Pool | null } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  const db = kyselyOn(pool);
  const on = (client: Client): Database => (client?.query ? kyselyOn(client) : db);
  const rows = (found: unknown[]) => found.map((row) => mapRow(row as NotificationRow) as InboxNotification);

  // Writes join the caller's transaction, or run in their own.
  function mutate<T>(client: Client, callback: (db: Database) => Promise<T>): Promise<T> {
    return client?.query ? callback(kyselyOn(client)) : db.transaction().execute(callback);
  }

  // Every change a recipient can see takes the next revision of their inbox,
  // serialized per recipient so revisions never repeat.
  async function allocateRevision(tx: Database, recipientUserId: string): Promise<number> {
    await sql`SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:' || ${recipientUserId}))`.execute(
      tx
    );
    const row = await tx
      .selectFrom('user_notifications')
      .select(sql<string>`coalesce(max(revision), 0) + 1`.as('revision'))
      .where('recipient_user_id', '=', recipientUserId)
      .executeTakeFirstOrThrow();
    return Number(row.revision);
  }

  // One notification per recipient and message: new reasons merge in, and the
  // revision moves only when what the recipient sees changes.
  async function upsert({
    recipientUserId,
    actorUserId,
    roomId,
    sourceMessageId,
    reasons,
    body = '',
    client
  }: {
    recipientUserId: string;
    actorUserId: string;
    roomId: string;
    sourceMessageId: string;
    reasons: string[];
    body?: string;
    client?: Client;
  }): Promise<InboxNotification | null> {
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      const mergedReasons = sql<
        string[]
      >`(SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1))`;
      const row = await tx
        .insertInto('user_notifications')
        .values({
          id: crypto.randomUUID(),
          recipient_user_id: recipientUserId,
          actor_user_id: actorUserId,
          room_id: roomId,
          source_message_id: sourceMessageId,
          reasons: sql<string[]>`${reasons}::text[]`,
          body,
          revision
        })
        .onConflict((oc) =>
          oc.columns(['recipient_user_id', 'source_message_id']).doUpdateSet((eb) => ({
            reasons: mergedReasons,
            actor_user_id: eb.ref('excluded.actor_user_id'),
            body: eb.ref('excluded.body'),
            retracted_at: null,
            revision: sql<string>`CASE
              WHEN user_notifications.retracted_at IS NOT NULL
                OR user_notifications.reasons IS DISTINCT FROM ${mergedReasons}
                OR user_notifications.body IS DISTINCT FROM EXCLUDED.body
              THEN EXCLUDED.revision ELSE user_notifications.revision END`,
            updated_at: now
          }))
        )
        .returningAll()
        .executeTakeFirst();
      return mapRow(row);
    });
  }

  // Newest first, paged by (created_at, id).
  async function list({
    recipientUserId,
    limit = 50,
    before = null,
    client
  }: {
    recipientUserId: string;
    limit?: number;
    before?: Partial<CursorTuple> | null;
    client?: Client;
  }): Promise<InboxNotification[]> {
    let query = on(client)
      .selectFrom('user_notifications')
      .selectAll()
      .select(createdAtMicros)
      .where('recipient_user_id', '=', recipientUserId);
    if (before?.createdAtMicros) {
      query = query.where(
        sql<boolean>`(created_at, id) < (to_timestamp(${before.createdAtMicros}::numeric / 1000000.0), ${before.id || ''}::varchar)`
      );
    }
    return rows(
      await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.min(101, limit + 1))
        .execute()
    );
  }

  async function findFirstUnread(
    recipientUserId: string,
    { client }: { client?: Client } = {}
  ): Promise<InboxNotification | null> {
    const row = await on(client)
      .selectFrom('user_notifications')
      .selectAll()
      .select(createdAtMicros)
      .where('recipient_user_id', '=', recipientUserId)
      .where('read_at', 'is', null)
      .where('retracted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(1)
      .executeTakeFirst();
    return mapRow(row);
  }

  async function unreadCount(
    recipientUserId: string,
    { client }: { client?: Client } = {}
  ): Promise<{ count: number; revision: number }> {
    const row = await on(client)
      .selectFrom('user_notifications')
      .select([
        sql<number>`count(*) FILTER (WHERE read_at IS NULL AND retracted_at IS NULL)::int`.as('count'),
        sql<string>`coalesce(max(revision), 0)::bigint`.as('revision')
      ])
      .where('recipient_user_id', '=', recipientUserId)
      .executeTakeFirst();
    return { count: Number(row?.count || 0), revision: Number(row?.revision || 0) };
  }

  async function markRead({
    recipientUserId,
    notificationId,
    client
  }: {
    recipientUserId: string;
    notificationId: string;
    client?: Client;
  }): Promise<InboxNotification | null> {
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      const row = await tx
        .updateTable('user_notifications')
        .set({
          read_at: sql<Date>`coalesce(read_at, current_timestamp)`,
          revision: sql<string>`CASE WHEN read_at IS NULL THEN ${revision} ELSE revision END`,
          updated_at: sql<Date>`CASE WHEN read_at IS NULL THEN current_timestamp ELSE updated_at END`
        })
        .where('id', '=', notificationId)
        .where('recipient_user_id', '=', recipientUserId)
        .returningAll()
        .executeTakeFirst();
      return mapRow(row);
    });
  }

  // Marks unread notifications read, up to a read point when one is given.
  async function markUnreadRead(
    client: Client,
    recipientUserId: string,
    bound: Date | null,
    roomId?: string
  ): Promise<ReadAllResult> {
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      let query = tx
        .updateTable('user_notifications')
        .set({ read_at: now, revision, updated_at: now })
        .where('recipient_user_id', '=', recipientUserId)
        .where('read_at', 'is', null);
      if (roomId !== undefined) query = query.where('room_id', '=', roomId);
      if (bound) query = query.where('created_at', '<=', bound);
      const result = await query.executeTakeFirst();
      const updated = Number(result.numUpdatedRows);
      return { updated, revision: updated ? revision : null };
    });
  }

  async function markAllRead({
    recipientUserId,
    through = null,
    client
  }: {
    recipientUserId: string;
    through?: unknown;
    client?: Client;
  }): Promise<ReadAllResult> {
    const bound = readBound(through);
    if (bound === undefined) return { updated: 0, revision: null };
    return markUnreadRead(client, recipientUserId, bound);
  }

  async function retractByMessage(
    sourceMessageId: string,
    { client }: { client?: Client } = {}
  ): Promise<InboxNotification[]> {
    return mutate(client, async (tx) => {
      const recipients = await tx
        .selectFrom('user_notifications')
        .select('recipient_user_id')
        .distinct()
        .where('source_message_id', '=', sourceMessageId)
        .where('retracted_at', 'is', null)
        .orderBy('recipient_user_id')
        .execute();
      const retracted: unknown[] = [];
      for (const { recipient_user_id: recipientUserId } of recipients) {
        const revision = await allocateRevision(tx, recipientUserId);
        retracted.push(
          ...(await tx
            .updateTable('user_notifications')
            .set({ retracted_at: now, body: '', revision, updated_at: now })
            .where('source_message_id', '=', sourceMessageId)
            .where('recipient_user_id', '=', recipientUserId)
            .where('retracted_at', 'is', null)
            .returningAll()
            .execute())
        );
      }
      return rows(retracted);
    });
  }

  // Reading the message is reading its notification. Without this the bell kept
  // its badge over messages the reader had already seen, and a reload brought it
  // straight back because nothing had ever been written down.
  // A read point that is not a time retires nothing: treating it as "no bound"
  // would mark the whole room read past what the reader has seen.
  async function markReadForRoom({
    recipientUserId,
    roomId,
    through = null,
    client
  }: {
    recipientUserId: string;
    roomId: string;
    through?: unknown;
    client?: Client;
  }): Promise<ReadAllResult> {
    const bound = readBound(through);
    if (bound === undefined) return { updated: 0, revision: null };
    return markUnreadRead(client, recipientUserId, bound, roomId);
  }

  return { findFirstUnread, list, markAllRead, markRead, markReadForRoom, retractByMessage, unreadCount, upsert };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;

export { createInboxRepository, mapRow as mapNotificationRow };
