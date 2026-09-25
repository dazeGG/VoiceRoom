import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { transaction as runInTransaction } from '../../platform/db/pool.ts';
import { normalizeRoomMessageContent, type RoomMessageContentV1 } from '@voice-room/shared/room-message-content';

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
  content: RoomMessageContentV1 | null;
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
    content: normalizeRoomMessageContent(row.content),
    createdAt: toMillis(row.created_at)
  };
}

function createPinRepository({ client }: { client?: PinPool | null } = {}) {
  const defaultClient: PinPool | null = client ? (requireQuery(client) as PinPool) : null;
  const queryClient = (override?: QueryClient | null): QueryClient => requireQuery(override || defaultClient);

  async function transaction<T>(callback: (client: QueryClient) => Promise<T>): Promise<T> {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (typeof defaultClient?.connect !== 'function') return callback(queryClient());
    return runInTransaction(defaultClient as Pick<pg.Pool, 'connect'>, callback);
  }

  const on = (override?: QueryClient | null): Database => kyselyOn(queryClient(override));

  async function lockRoom({ roomId, client: override }: { roomId?: string } & Override = {}): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:room-pins:${roomId}`}))`.execute(on(override));
  }

  // Pins whose message is still there; deleted messages are dropped here rather
  // than in the service so the count and the list can never disagree.
  function livePins(db: Database, roomId: string | undefined) {
    return db
      .selectFrom('room_message_pins as p')
      .innerJoin('room_messages as m', 'm.id', 'p.message_id')
      .where('p.room_id', '=', roomId as string)
      .where('m.deleted_at', 'is', null);
  }

  // Pinned messages, newest pin first.
  async function listPins({
    roomId,
    limit = 50,
    client: override
  }: { roomId?: string; limit?: number } & Override = {}): Promise<StoredPin[]> {
    const db = on(override);
    const rows = await livePins(db, roomId)
      .leftJoin('users as pinner', 'pinner.id', 'p.pinned_by')
      .select([
        'p.message_id',
        'p.pinned_by',
        'p.pinned_at',
        'pinner.display_name as pinned_by_name',
        'm.peer_id',
        'm.author_user_id',
        'm.name',
        'm.text',
        'm.content',
        'm.created_at'
      ])
      .orderBy('p.pinned_at', 'desc')
      .orderBy('p.message_id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(mapPin);
  }

  async function countPins({ roomId, client: override }: { roomId?: string } & Override = {}): Promise<number> {
    const row = await livePins(on(override), roomId)
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .executeTakeFirst();
    return row?.count || 0;
  }

  // Resolves the message only when it actually belongs to the room and is still
  // visible, so a caller cannot pin someone else's message into their own room.
  async function findVisibleMessage({
    roomId,
    messageId,
    client: override
  }: { roomId?: string; messageId?: string } & Override = {}): Promise<boolean> {
    const row = await on(override)
      .selectFrom('room_messages')
      .select('id')
      .where('id', '=', messageId as string)
      .where('room_id', '=', roomId as string)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function pin({
    roomId,
    messageId,
    userId,
    client: override
  }: { roomId?: string; messageId?: string; userId?: string } & Override = {}): Promise<{ changed: boolean }> {
    const result = await on(override)
      .insertInto('room_message_pins')
      .values({ room_id: roomId as string, message_id: messageId as string, pinned_by: userId as string })
      .onConflict((oc) => oc.columns(['room_id', 'message_id']).doNothing())
      .executeTakeFirst();
    return { changed: Number(result.numInsertedOrUpdatedRows ?? 0) > 0 };
  }

  async function unpin({
    roomId,
    messageId,
    client: override
  }: { roomId?: string; messageId?: string } & Override = {}): Promise<{ changed: boolean }> {
    const result = await on(override)
      .deleteFrom('room_message_pins')
      .where('room_id', '=', roomId as string)
      .where('message_id', '=', messageId as string)
      .executeTakeFirst();
    return { changed: result.numDeletedRows > 0n };
  }

  return Object.freeze({ countPins, findVisibleMessage, listPins, lockRoom, pin, transaction, unpin });
}

export { createPinRepository };
