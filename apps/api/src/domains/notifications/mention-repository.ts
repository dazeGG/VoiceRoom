import crypto from 'node:crypto';
import type pg from 'pg';

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

function executor(pool: QueryClient, client: Client): QueryClient {
  return client?.query ? client : pool;
}

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
  const defaultDb = pool;

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
    const db = executor(defaultDb, client);
    const unique = [...new Set(targetUserIds)];
    await db.query(
      `UPDATE room_message_mentions SET retracted_at = current_timestamp, revision = revision + 1
       WHERE message_id = $1 AND retracted_at IS NULL AND NOT (target_user_id = ANY($2::varchar[]))`,
      [messageId, unique]
    );
    const mentions: (Mention | null)[] = [];
    for (const targetUserId of unique) {
      const result = await db.query<MentionRow>(
        `INSERT INTO room_message_mentions (id, room_id, message_id, creator_user_id, target_user_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (message_id, target_user_id) DO UPDATE
         SET retracted_at = NULL,
             revision = CASE WHEN room_message_mentions.retracted_at IS NULL THEN room_message_mentions.revision ELSE room_message_mentions.revision + 1 END
         RETURNING *`,
        [crypto.randomUUID(), roomId, messageId, creatorUserId, targetUserId]
      );
      mentions.push(mapMention(result.rows[0]));
    }
    return mentions;
  }

  async function listActive(messageId: string, { client }: { client?: Client } = {}): Promise<Mention[]> {
    const result = await executor(defaultDb, client).query<MentionRow>(
      'SELECT * FROM room_message_mentions WHERE message_id = $1 AND retracted_at IS NULL ORDER BY target_user_id',
      [messageId]
    );
    return result.rows.map(mapMention) as Mention[];
  }

  async function retractForMessage(messageId: string, { client }: { client?: Client } = {}): Promise<Mention[]> {
    const result = await executor(defaultDb, client).query<MentionRow>(
      `UPDATE room_message_mentions SET retracted_at = current_timestamp, revision = revision + 1
       WHERE message_id = $1 AND retracted_at IS NULL RETURNING *`,
      [messageId]
    );
    return result.rows.map(mapMention) as Mention[];
  }

  return { listActive, replaceForMessage, retractForMessage };
}

export type MentionRepository = ReturnType<typeof createMentionRepository>;

export { createMentionRepository, mapMention };
