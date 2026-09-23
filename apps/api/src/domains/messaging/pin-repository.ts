import type pg from 'pg';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type PinPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };

type PinRow = {
  message_id: string;
  pinned_by: string;
  pinned_by_name: string | null;
  pinned_at: Date | string | null;
  peer_id: string | null;
  author_user_id: string | null;
  name: string | null;
  text: string | null;
  content: unknown;
  created_at: Date | string | null;
};

export type StoredPin = {
  messageId: string;
  pinnedBy: string;
  pinnedByName: string;
  pinnedAt: number | null;
  author: { peerId: string; userId: string | null; name: string };
  text: string;
  content: unknown;
  createdAt: number | null;
};

type Override = { client?: QueryClient | null };

function requireQuery(client: QueryClient | null | undefined): QueryClient {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Pin repository requires a PostgreSQL query client');
  }
  return client;
}

function toMillis(value: Date | string | null): number | null {
  if (!value) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function mapPin(row: PinRow): StoredPin {
  return {
    messageId: row.message_id,
    pinnedBy: row.pinned_by,
    pinnedByName: row.pinned_by_name || '',
    pinnedAt: toMillis(row.pinned_at),
    author: {
      peerId: row.peer_id || '',
      userId: row.author_user_id || null,
      name: row.name || ''
    },
    text: row.text || '',
    content: row.content || null,
    createdAt: toMillis(row.created_at)
  };
}

function createPinRepository({ client }: { client?: PinPool | null } = {}) {
  const defaultClient: PinPool | null = client ? requireQuery(client) as PinPool : null;
  const queryClient = (override?: QueryClient | null): QueryClient => requireQuery(override || defaultClient);

  async function transaction<T>(callback: (client: QueryClient) => Promise<T>): Promise<T> {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (typeof defaultClient?.connect !== 'function') return callback(queryClient());
    const db = await defaultClient.connect();
    try {
      await db.query('BEGIN');
      const result = await callback(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async function lockRoom({ roomId, client: override }: { roomId?: string } & Override = {}): Promise<void> {
    await queryClient(override).query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`voice-room:room-pins:${roomId}`]
    );
  }

  // Pinned messages, newest pin first. Deleted messages are dropped here rather
  // than in the service so the count and the list can never disagree.
  async function listPins({ roomId, limit = 50, client: override }: { roomId?: string; limit?: number } & Override = {}): Promise<StoredPin[]> {
    const result = await queryClient(override).query<PinRow>(
      `SELECT p.message_id,
              p.pinned_by,
              p.pinned_at,
              pinner.display_name AS pinned_by_name,
              m.peer_id,
              m.author_user_id,
              m.name,
              m.text,
              m.content,
              m.created_at
       FROM room_message_pins p
       JOIN room_messages m ON m.id = p.message_id
       LEFT JOIN users pinner ON pinner.id = p.pinned_by
       WHERE p.room_id = $1 AND m.deleted_at IS NULL
       ORDER BY p.pinned_at DESC, p.message_id DESC
       LIMIT $2`,
      [roomId, limit]
    );
    return result.rows.map(mapPin);
  }

  async function countPins({ roomId, client: override }: { roomId?: string } & Override = {}): Promise<number> {
    const result = await queryClient(override).query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM room_message_pins p
       JOIN room_messages m ON m.id = p.message_id
       WHERE p.room_id = $1 AND m.deleted_at IS NULL`,
      [roomId]
    );
    return result.rows[0]?.count || 0;
  }

  // Resolves the message only when it actually belongs to the room and is still
  // visible, so a caller cannot pin someone else's message into their own room.
  async function findVisibleMessage({ roomId, messageId, client: override }: { roomId?: string; messageId?: string } & Override = {}): Promise<boolean> {
    const result = await queryClient(override).query(
      `SELECT id FROM room_messages
       WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
      [messageId, roomId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async function pin({ roomId, messageId, userId, client: override }: { roomId?: string; messageId?: string; userId?: string } & Override = {}): Promise<{ changed: boolean }> {
    const result = await queryClient(override).query(
      `INSERT INTO room_message_pins (room_id, message_id, pinned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, message_id) DO NOTHING`,
      [roomId, messageId, userId]
    );
    return { changed: (result.rowCount ?? 0) > 0 };
  }

  async function unpin({ roomId, messageId, client: override }: { roomId?: string; messageId?: string } & Override = {}): Promise<{ changed: boolean }> {
    const result = await queryClient(override).query(
      `DELETE FROM room_message_pins WHERE room_id = $1 AND message_id = $2`,
      [roomId, messageId]
    );
    return { changed: (result.rowCount ?? 0) > 0 };
  }

  return Object.freeze({ countPins, findVisibleMessage, listPins, lockRoom, pin, transaction, unpin });
}

export { createPinRepository };
