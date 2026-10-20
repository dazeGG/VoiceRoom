import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { canConnect } from '../../platform/db/connectable.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { RoomMessageReactionRevisions, RoomMessageReactions } from '../../platform/db/schema.ts';
import { transaction as runInTransaction } from '../../platform/db/pool.ts';

// Room and DM reactions live in tables with the same columns.
type ReactionTable = 'room_message_reactions' | 'direct_message_reactions';
type RevisionTable = 'room_message_reaction_revisions' | 'direct_message_reaction_revisions';

const CONTEXT_TABLES = Object.freeze({
  room: Object.freeze({
    reactions: 'room_message_reactions',
    revisions: 'room_message_reaction_revisions'
  }),
  dm: Object.freeze({
    reactions: 'direct_message_reactions',
    revisions: 'direct_message_reaction_revisions'
  })
});

type QueryClient = Pick<pg.PoolClient, 'query'>;
type ReactionPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };
type Override = { client?: QueryClient | null | undefined };
type SummaryRow = {
  emoji: string;
  revision: string | number | null;
  reaction_count: number | null;
  reacted_by_me: boolean | null;
};
type ReactorRow = {
  user_id: string;
  display_name: string;
  avatar_key: string | null;
  created_at_micros: string | number;
};

export type StoredReactionSummary = { emoji: string; count: number; reactedByMe: boolean; revision: string };
export type StoredReactor = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  cursorTuple: { createdAtMicros: string; id: string };
};

type Target = { type: string; messageId: string; emoji: string };

function requireQuery<T extends QueryClient>(client: T | null | undefined): T {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Reaction repository requires a PostgreSQL query client');
  }
  return client;
}

// Aliased joins over either pair of tables: Kysely cannot alias a union of
// table names, so the rows are typed as the room pair's (the DM tables have
// the same columns).
function asRevisions(table: RevisionTable) {
  return sql<Selectable<RoomMessageReactionRevisions>>`${sql.table(table)}`.as('v');
}
function asReactions(table: ReactionTable) {
  return sql<Selectable<RoomMessageReactions>>`${sql.table(table)}`.as('r');
}

function contextTables(type: string): { reactions: ReactionTable; revisions: RevisionTable } {
  if (type !== 'room' && type !== 'dm') throw new TypeError('Reaction context must be room or dm');
  return CONTEXT_TABLES[type];
}

function mapSummary(row: SummaryRow, userId: string | null | undefined): StoredReactionSummary {
  return {
    emoji: row.emoji,
    count: Number(row.reaction_count || 0),
    reactedByMe: Boolean(userId && row.reacted_by_me),
    revision: String(row.revision || 0)
  };
}

function mapReactor(row: ReactorRow): StoredReactor {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    cursorTuple: {
      createdAtMicros: String(row.created_at_micros),
      id: row.user_id
    }
  };
}

function createReactionRepository({ client }: { client?: ReactionPool | null } = {}) {
  const defaultClient = client ? requireQuery(client) : null;
  const queryClient = (override?: QueryClient | null): QueryClient => requireQuery(override || defaultClient);
  const on = (override?: QueryClient | null): Database => kyselyOn(queryClient(override));

  // A raw pg transaction: the reaction service threads the client through
  // every call so the toggle and its summary commit together.
  async function transaction<T>(callback: (client: QueryClient) => Promise<T>): Promise<T> {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (!canConnect(defaultClient)) return callback(queryClient());
    return runInTransaction(defaultClient, callback);
  }

  // The per-emoji revision row exists from the first toggle on, locked for the
  // rest of the caller's transaction.
  async function ensureRevision({ type, messageId, emoji, client: override }: Target & Override): Promise<string> {
    const db = on(override);
    const { revisions } = contextTables(type);
    await db
      .insertInto(revisions)
      .values({ message_id: messageId, emoji })
      .onConflict((oc) => oc.columns(['message_id', 'emoji']).doNothing())
      .execute();
    const row = await db
      .selectFrom(revisions)
      .select('revision')
      .where('message_id', '=', messageId)
      .where('emoji', '=', emoji)
      .forUpdate()
      .executeTakeFirst();
    return String(row?.revision || 0);
  }

  async function getActive({
    type,
    messageId,
    emoji,
    userId,
    client: override
  }: Target & { userId: string } & Override): Promise<boolean> {
    const { reactions } = contextTables(type);
    const row = await on(override)
      .selectFrom(reactions)
      .select('user_id')
      .where('message_id', '=', messageId)
      .where('emoji', '=', emoji)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function setDesiredState({
    type,
    messageId,
    emoji,
    userId,
    active,
    client: override
  }: Target & { userId: string; active?: boolean } & Override): Promise<{ changed: boolean; revision: string }> {
    const db = on(override);
    const { reactions, revisions } = contextTables(type);
    const currentRevision = await ensureRevision({ type, messageId, emoji, client: override });
    const currentActive = await getActive({ type, messageId, emoji, userId, client: override });

    if (currentActive === active) {
      return { changed: false, revision: currentRevision };
    }

    // ensureRevision inserted and locked this row above, so the update returns it.
    const bumped = await db
      .updateTable(revisions)
      .set({ revision: sql<string>`revision + 1`, updated_at: sql<Date>`current_timestamp` })
      .where('message_id', '=', messageId)
      .where('emoji', '=', emoji)
      .returning('revision')
      .executeTakeFirstOrThrow();
    const revision = String(bumped.revision);

    if (active) {
      await db.insertInto(reactions).values({ message_id: messageId, emoji, user_id: userId, revision }).execute();
    } else {
      await db
        .deleteFrom(reactions)
        .where('message_id', '=', messageId)
        .where('emoji', '=', emoji)
        .where('user_id', '=', userId)
        .execute();
    }

    return { changed: true, revision };
  }

  function summaryColumns(userId: string | null | undefined) {
    return [
      sql<number>`COUNT(r.user_id)::integer`.as('reaction_count'),
      sql<boolean>`COALESCE(BOOL_OR(r.user_id = ${userId || null}), false)`.as('reacted_by_me')
    ] as const;
  }

  async function getSummary({
    type,
    messageId,
    emoji,
    userId,
    client: override
  }: Target & { userId?: string | null } & Override): Promise<StoredReactionSummary> {
    const { reactions, revisions } = contextTables(type);
    const row = await on(override)
      .selectFrom(asRevisions(revisions))
      .leftJoin(asReactions(reactions), (join) =>
        join.onRef('r.message_id', '=', 'v.message_id').onRef('r.emoji', '=', 'v.emoji')
      )
      .select(['v.emoji', 'v.revision', ...summaryColumns(userId)])
      .where('v.message_id', '=', messageId)
      .where('v.emoji', '=', emoji)
      .groupBy(['v.emoji', 'v.revision'])
      .executeTakeFirst();
    return row ? mapSummary(row, userId) : { emoji, count: 0, reactedByMe: false, revision: '0' };
  }

  async function listSummaries({
    type,
    messageId,
    userId,
    client: override
  }: Omit<Target, 'emoji'> & { userId?: string | null } & Override): Promise<StoredReactionSummary[]> {
    const { reactions, revisions } = contextTables(type);
    const rows = await on(override)
      .selectFrom(asRevisions(revisions))
      .innerJoin(asReactions(reactions), (join) =>
        join.onRef('r.message_id', '=', 'v.message_id').onRef('r.emoji', '=', 'v.emoji')
      )
      .select(['v.emoji', 'v.revision', ...summaryColumns(userId)])
      .where('v.message_id', '=', messageId)
      .groupBy(['v.emoji', 'v.revision'])
      .orderBy(sql`MIN(r.created_at)`)
      .orderBy('v.emoji')
      .execute();
    return rows.map((row) => mapSummary(row, userId));
  }

  /** listSummaries for a page of messages in one query, by message id. */
  async function listSummariesForMessages({
    type,
    messageIds,
    userId,
    client: override
  }: Pick<Target, 'type'> & { messageIds: string[]; userId?: string | null } & Override): Promise<
    Map<string, StoredReactionSummary[]>
  > {
    const { reactions, revisions } = contextTables(type);
    const byMessage = new Map<string, StoredReactionSummary[]>();
    if (messageIds.length === 0) return byMessage;
    const rows = await on(override)
      .selectFrom(asRevisions(revisions))
      .innerJoin(asReactions(reactions), (join) =>
        join.onRef('r.message_id', '=', 'v.message_id').onRef('r.emoji', '=', 'v.emoji')
      )
      .select(['v.message_id', 'v.emoji', 'v.revision', ...summaryColumns(userId)])
      .where('v.message_id', 'in', messageIds)
      .groupBy(['v.message_id', 'v.emoji', 'v.revision'])
      .orderBy('v.message_id')
      .orderBy(sql`MIN(r.created_at)`)
      .orderBy('v.emoji')
      .execute();
    for (const row of rows) {
      const list = byMessage.get(row.message_id);
      const summary = mapSummary(row, userId);
      if (list) list.push(summary);
      else byMessage.set(row.message_id, [summary]);
    }
    return byMessage;
  }

  // Who reacted with an emoji, oldest first, paged by (created_at, user_id).
  async function listReactors({
    type,
    messageId,
    emoji,
    limit,
    after,
    client: override
  }: Target & {
    limit: number;
    after?: { createdAtMicros: string; id: string } | null;
  } & Override): Promise<StoredReactor[]> {
    const { reactions } = contextTables(type);
    let query = on(override)
      .selectFrom(asReactions(reactions))
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.user_id',
        sql<string>`COALESCE(NULLIF(u.display_name, ''), u.login, 'Пользователь')`.as('display_name'),
        'u.avatar_key',
        sql<string>`FLOOR(EXTRACT(EPOCH FROM r.created_at) * 1000000)::bigint`.as('created_at_micros')
      ])
      .where('r.message_id', '=', messageId)
      .where('r.emoji', '=', emoji);
    if (after) {
      query = query.where(
        sql<boolean>`(r.created_at, r.user_id) > (to_timestamp(${after.createdAtMicros}::numeric / 1000000), ${after.id})`
      );
    }
    const rows = await query.orderBy('r.created_at', 'asc').orderBy('r.user_id', 'asc').limit(limit).execute();
    return rows.map(mapReactor);
  }

  return Object.freeze({
    getActive,
    getSummary,
    listReactors,
    listSummaries,
    listSummariesForMessages,
    setDesiredState,
    transaction
  });
}

export { createReactionRepository };
