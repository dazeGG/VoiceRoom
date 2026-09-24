import crypto from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../lib/db.ts';

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

function dbFor(pool: QueryClient, client: Client): QueryClient { return client?.query ? client : pool; }

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
  const db = pool;

  function mutate<T>(client: Client, callback: (db: QueryClient) => Promise<T>): Promise<T> {
    return client?.query ? callback(client) : transaction(db, callback);
  }

  async function allocateRevision(tx: QueryClient, recipientUserId: string): Promise<number> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:' || $1))`, [recipientUserId]);
    const result = await tx.query<{ revision: string | number }>(
      `SELECT coalesce(max(revision),0)+1 AS revision FROM user_notifications WHERE recipient_user_id=$1`,
      [recipientUserId]
    );
    return Number(result.rows[0]!.revision);
  }

  async function upsert({ recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body = '', client }: {
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
      const result = await tx.query<NotificationRow>(
        `INSERT INTO user_notifications (id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,body,revision)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)
       ON CONFLICT (recipient_user_id, source_message_id) DO UPDATE SET
         reasons=(SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)),
         actor_user_id=EXCLUDED.actor_user_id, body=EXCLUDED.body, retracted_at=NULL,
         revision=CASE WHEN user_notifications.retracted_at IS NOT NULL OR user_notifications.reasons IS DISTINCT FROM (SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)) OR user_notifications.body IS DISTINCT FROM EXCLUDED.body THEN EXCLUDED.revision ELSE user_notifications.revision END,
         updated_at=current_timestamp RETURNING *`,
        [crypto.randomUUID(), recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body, revision]
      );
      return mapRow(result.rows[0]);
    });
  }

  async function list({ recipientUserId, limit = 50, before = null, client }: {
    recipientUserId: string;
    limit?: number;
    before?: Partial<CursorTuple> | null;
    client?: Client;
  }): Promise<InboxNotification[]> {
    const result = await dbFor(db, client).query<NotificationRow>(
      `SELECT *, floor(extract(epoch FROM created_at)*1000000)::numeric(20,0) created_at_micros
       FROM user_notifications WHERE recipient_user_id=$1
         AND ($2::numeric IS NULL OR (created_at,id)<(to_timestamp($2::numeric/1000000.0),$3::varchar))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
      [recipientUserId, before?.createdAtMicros || null, before?.id || '', Math.min(101, limit + 1)]
    );
    return result.rows.map(mapRow) as InboxNotification[];
  }

  async function findFirstUnread(recipientUserId: string, { client }: { client?: Client } = {}): Promise<InboxNotification | null> {
    const r = await dbFor(db, client).query<NotificationRow>(
      `SELECT *,floor(extract(epoch FROM created_at)*1000000)::numeric(20,0) created_at_micros FROM user_notifications WHERE recipient_user_id=$1 AND read_at IS NULL AND retracted_at IS NULL ORDER BY created_at ASC,id ASC LIMIT 1`,
      [recipientUserId]
    );
    return mapRow(r.rows[0]);
  }

  async function unreadCount(recipientUserId: string, { client }: { client?: Client } = {}): Promise<{ count: number; revision: number }> {
    const r = await dbFor(db, client).query<{ count: number | null; revision: string | number | null }>(
      `SELECT count(*) FILTER (WHERE read_at IS NULL AND retracted_at IS NULL)::int count,coalesce(max(revision),0)::bigint revision FROM user_notifications WHERE recipient_user_id=$1`,
      [recipientUserId]
    );
    return { count: Number(r.rows[0]?.count || 0), revision: Number(r.rows[0]?.revision || 0) };
  }

  async function markRead({ recipientUserId, notificationId, client }: {
    recipientUserId: string;
    notificationId: string;
    client?: Client;
  }): Promise<InboxNotification | null> {
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      const r = await tx.query<NotificationRow>(
        `UPDATE user_notifications SET read_at=coalesce(read_at,current_timestamp),revision=CASE WHEN read_at IS NULL THEN $3 ELSE revision END,updated_at=CASE WHEN read_at IS NULL THEN current_timestamp ELSE updated_at END WHERE id=$1 AND recipient_user_id=$2 RETURNING *`,
        [notificationId, recipientUserId, revision]
      );
      return mapRow(r.rows[0]);
    });
  }

  async function markAllRead({ recipientUserId, through = null, client }: {
    recipientUserId: string;
    through?: unknown;
    client?: Client;
  }): Promise<ReadAllResult> {
    const bound = readBound(through);
    if (bound === undefined) return { updated: 0, revision: null };
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      const r = await tx.query(
        `UPDATE user_notifications SET read_at=current_timestamp,revision=$3,updated_at=current_timestamp WHERE recipient_user_id=$1 AND read_at IS NULL AND ($2::timestamptz IS NULL OR created_at <= $2)`,
        [recipientUserId, bound, revision]
      );
      return { updated: r.rowCount, revision: r.rowCount ? revision : null };
    });
  }

  async function retractByMessage(sourceMessageId: string, { client }: { client?: Client } = {}): Promise<InboxNotification[]> {
    return mutate(client, async (tx) => {
      const recipients = await tx.query<{ recipient_user_id: string }>(
        `SELECT DISTINCT recipient_user_id FROM user_notifications WHERE source_message_id=$1 AND retracted_at IS NULL ORDER BY recipient_user_id`,
        [sourceMessageId]
      );
      const rows: NotificationRow[] = [];
      for (const { recipient_user_id: recipientUserId } of recipients.rows) {
        const revision = await allocateRevision(tx, recipientUserId);
        const r = await tx.query<NotificationRow>(
          `UPDATE user_notifications SET retracted_at=current_timestamp,body='',revision=$3,updated_at=current_timestamp WHERE source_message_id=$1 AND recipient_user_id=$2 AND retracted_at IS NULL RETURNING *`,
          [sourceMessageId, recipientUserId, revision]
        );
        rows.push(...r.rows);
      }
      return rows.map(mapRow) as InboxNotification[];
    });
  }

  // Reading the message is reading its notification. Without this the bell kept
  // its badge over messages the reader had already seen, and a reload brought it
  // straight back because nothing had ever been written down.
  // A read point that is not a time retires nothing: treating it as "no bound"
  // would mark the whole room read past what the reader has seen.
  async function markReadForRoom({ recipientUserId, roomId, through = null, client }: {
    recipientUserId: string;
    roomId: string;
    through?: unknown;
    client?: Client;
  }): Promise<ReadAllResult> {
    const bound = readBound(through);
    if (bound === undefined) return { updated: 0, revision: null };
    return mutate(client, async (tx) => {
      const revision = await allocateRevision(tx, recipientUserId);
      const r = await tx.query(
        `UPDATE user_notifications SET read_at=current_timestamp,revision=$4,updated_at=current_timestamp WHERE recipient_user_id=$1 AND room_id=$2 AND read_at IS NULL AND ($3::timestamptz IS NULL OR created_at <= $3)`,
        [recipientUserId, roomId, bound, revision]
      );
      return { updated: r.rowCount, revision: r.rowCount ? revision : null };
    });
  }

  return { findFirstUnread, list, markAllRead, markRead, markReadForRoom, retractByMessage, unreadCount, upsert };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;

export { createInboxRepository, mapRow as mapNotificationRow };
