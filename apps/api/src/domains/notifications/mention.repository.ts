import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;

type MentionRow = {
  id: string;
  room_id: string;
  message_id: string;
  creator_user_id: string;
  target_user_id: string;
  revision: number | string;
  created_at: unknown;
  retracted_at: unknown;
};

export type Mention = {
  id: string;
  roomId: string;
  messageId: string;
  creatorUserId: string;
  targetUserId: string;
  revision: number;
  createdAt: unknown;
  retractedAt: unknown;
};

function mapMention(row: MentionRow | null | undefined): Mention | null {
  return row
    ? {
        id: row.id,
        roomId: row.room_id,
        messageId: row.message_id,
        creatorUserId: row.creator_user_id,
        targetUserId: row.target_user_id,
        revision: Number(row.revision),
        createdAt: row.created_at,
        retractedAt: row.retracted_at
      }
    : null;
}

function createMentionRepository({ pool }: { pool?: QueryClient | null } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  const base = pool;
  const on = (client: Client): Database => kyselyOn(client?.query ? client : base);
  const retract = sql<string>`revision + 1`;

  // An edit's mentions replace the old ones: dropped targets are retracted,
  // kept ones stay as they were, restored ones come back at a new revision.
  async function replaceForMessage({
    roomId,
    messageId,
    creatorUserId,
    targetUserIds = [],
    client
  }: {
    roomId: string;
    messageId: string;
    creatorUserId: string;
    targetUserIds?: string[];
    client?: Client;
  }): Promise<(Mention | null)[]> {
    const db = on(client);
    const unique = [...new Set(targetUserIds)];
    await db
      .updateTable('room_message_mentions')
      .set({ retracted_at: sql<Date>`current_timestamp`, revision: retract })
      .where('message_id', '=', messageId)
      .where('retracted_at', 'is', null)
      .where(sql<boolean>`NOT (target_user_id = ANY(${unique}::varchar[]))`)
      .execute();
    const mentions: (Mention | null)[] = [];
    for (const targetUserId of unique) {
      const row = await db
        .insertInto('room_message_mentions')
        .values({
          id: crypto.randomUUID(),
          room_id: roomId,
          message_id: messageId,
          creator_user_id: creatorUserId,
          target_user_id: targetUserId
        })
        .onConflict((oc) =>
          oc.columns(['message_id', 'target_user_id']).doUpdateSet({
            retracted_at: null,
            revision: sql<string>`CASE WHEN room_message_mentions.retracted_at IS NULL
              THEN room_message_mentions.revision ELSE room_message_mentions.revision + 1 END`
          })
        )
        .returningAll()
        .executeTakeFirst();
      mentions.push(mapMention(row));
    }
    return mentions;
  }

  async function listActive(messageId: string, { client }: { client?: Client } = {}): Promise<Mention[]> {
    const rows = await on(client)
      .selectFrom('room_message_mentions')
      .selectAll()
      .where('message_id', '=', messageId)
      .where('retracted_at', 'is', null)
      .orderBy('target_user_id')
      .execute();
    return rows.map((row) => mapMention(row as MentionRow) as Mention);
  }

  async function retractForMessage(messageId: string, { client }: { client?: Client } = {}): Promise<Mention[]> {
    const rows = await on(client)
      .updateTable('room_message_mentions')
      .set({ retracted_at: sql<Date>`current_timestamp`, revision: retract })
      .where('message_id', '=', messageId)
      .where('retracted_at', 'is', null)
      .returningAll()
      .execute();
    return rows.map((row) => mapMention(row as MentionRow) as Mention);
  }

  return { listActive, replaceForMessage, retractForMessage };
}

export type MentionRepository = ReturnType<typeof createMentionRepository>;

export { createMentionRepository, mapMention };
