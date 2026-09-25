// The rooms table: creation under quota, rename, avatar, the empty/idle
// lifecycle and the purge of what was deleted long enough ago.

import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import type { Rooms } from '../../platform/db/schema.ts';

export type RoomRelationship = 'owner' | 'bookmarked' | 'member' | '';
/** A room row, plus the per-user columns some listings add. */
export type RoomRow = Selectable<Rooms> & { last_message_at?: Date | null; unread_count?: number };
export type StoredRoom = ReturnType<typeof mapRoom>;
export type RoomCreation =
  | { room: StoredRoom; status: 'created' }
  | { room: null; status: 'auth_required' | 'quota_exceeded' | 'capacity_exceeded' };

export function createRowId(): string {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function createRoomId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function normalizePositiveInt(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

export function toDate(ms: unknown): Date {
  return new Date(normalizePositiveInt(ms, Date.now()));
}

export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function mapRoom(row: RoomRow) {
  return {
    avatarKey: row.avatar_key || null,
    createdAt: toMillis(row.created_at),
    creatorIp: row.creator_ip || '',
    emptySince: row.empty_since ? toMillis(row.empty_since) : null,
    id: row.id,
    isStatic: Boolean(row.is_static),
    lastMessageAt: Object.hasOwn(row, 'last_message_at')
      ? row.last_message_at
        ? toMillis(row.last_message_at)
        : null
      : undefined,
    name: row.name || '',
    ownerId: row.owner_id || null,
    unreadCount: Object.hasOwn(row, 'unread_count') ? normalizePositiveInt(row.unread_count, 0) : undefined,
    updatedAt: toMillis(row.updated_at)
  };
}

export function mapRoomOrNull(row: RoomRow | undefined): StoredRoom | null {
  return row ? mapRoom(row) : null;
}

function roomIdFrom(roomOrId: string | { id?: string } | null | undefined): string | undefined {
  return typeof roomOrId === 'string' ? roomOrId : roomOrId?.id;
}

const countAll = sql<number>`COUNT(*)::int`.as('count');

/** Serializes room creation across replicas: quotas count rooms other creators may be adding. */
export async function lockRoomCreation(db: Database): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'voice-room:create-room'}))`.execute(db);
}

async function countOwnedStaticRooms(db: Database, userId: string): Promise<number> {
  const row = await db
    .selectFrom('room_memberships as rm')
    .innerJoin('rooms as r', 'r.id', 'rm.room_id')
    .select(countAll)
    .where('rm.user_id', '=', userId)
    .where('rm.role', '=', 'owner')
    .where('r.is_static', '=', true)
    .where('r.deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.count || 0;
}

async function countTemporaryRoomsForIp(db: Database, creatorIp: string): Promise<number> {
  const row = await db
    .selectFrom('rooms')
    .select(countAll)
    .where('creator_ip', '=', creatorIp)
    .where('deleted_at', 'is', null)
    .where('is_static', '=', false)
    .executeTakeFirst();
  return row?.count || 0;
}

async function countLiveRooms(db: Database): Promise<number> {
  const row = await db.selectFrom('rooms').select(countAll).where('deleted_at', 'is', null).executeTakeFirst();
  return row?.count || 0;
}

type NewRoom = { id: string; creatorIp: string; isStatic: boolean; ownerId: string | null; name: string; at: Date };

function insertRoom(db: Database, room: NewRoom) {
  return db
    .insertInto('rooms')
    .values({
      id: room.id,
      creator_ip: room.creatorIp,
      is_static: room.isStatic,
      owner_id: room.ownerId,
      name: room.name,
      created_at: room.at,
      updated_at: room.at,
      empty_since: room.at
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function createRoomRepository({ db, roomIdleTtlMs = 15 * 60 * 1000 }: { db: Database; roomIdleTtlMs?: number }) {
  async function createRoom({
    roomId = createRoomId(),
    creatorIp,
    isStatic = false,
    ownerId = null,
    name = '',
    now = Date.now()
  }: {
    roomId?: string;
    creatorIp?: unknown;
    isStatic?: boolean;
    ownerId?: string | null;
    name?: unknown;
    now?: number;
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }
    const row = await insertRoom(db, {
      id,
      creatorIp: typeof creatorIp === 'string' ? creatorIp : '',
      isStatic: Boolean(isStatic),
      ownerId: ownerId || null,
      name: typeof name === 'string' ? name : '',
      at: toDate(now)
    });
    return mapRoom(row);
  }

  async function createRoomWithQuota({
    roomId = createRoomId(),
    creatorIp,
    isStatic = false,
    ownerId = null,
    name = '',
    maxOwnedStaticRoomsPerUser = 3,
    maxQuotaRoomsPerIp = 0,
    maxRooms = 100,
    maxTempRoomsPerIp = maxQuotaRoomsPerIp,
    now = Date.now()
  }: {
    roomId?: string;
    creatorIp?: unknown;
    isStatic?: boolean;
    ownerId?: string | null;
    name?: unknown;
    maxOwnedStaticRoomsPerUser?: number;
    maxQuotaRoomsPerIp?: number;
    maxRooms?: number;
    maxTempRoomsPerIp?: number;
    now?: number;
  }): Promise<RoomCreation> {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    return db.transaction().execute(async (trx): Promise<RoomCreation> => {
      await lockRoomCreation(trx);

      const normalizedCreatorIp = typeof creatorIp === 'string' ? creatorIp : '';
      if (isStatic && !ownerId) {
        return { room: null, status: 'auth_required' };
      }
      if (isStatic && ownerId && maxOwnedStaticRoomsPerUser > 0) {
        if ((await countOwnedStaticRooms(trx, ownerId)) >= maxOwnedStaticRoomsPerUser) {
          return { room: null, status: 'quota_exceeded' };
        }
      }
      if (!isStatic && maxTempRoomsPerIp > 0) {
        if ((await countTemporaryRoomsForIp(trx, normalizedCreatorIp)) >= maxTempRoomsPerIp) {
          return { room: null, status: 'quota_exceeded' };
        }
      }
      if ((await countLiveRooms(trx)) >= maxRooms) {
        return { room: null, status: 'capacity_exceeded' };
      }

      const at = toDate(now);
      const inserted = await insertRoom(trx, {
        id,
        creatorIp: normalizedCreatorIp,
        isStatic: Boolean(isStatic),
        ownerId: ownerId || null,
        name: typeof name === 'string' ? name : '',
        at
      });
      if (isStatic && ownerId) {
        await trx
          .insertInto('room_memberships')
          .values({ id: createRowId(), room_id: id, user_id: ownerId, role: 'owner', created_at: at, updated_at: at })
          .onConflict((oc) =>
            oc.columns(['room_id', 'user_id']).doUpdateSet((eb) => ({
              role: 'owner',
              updated_at: eb.ref('excluded.updated_at')
            }))
          )
          .execute();
      }

      return { room: mapRoom(inserted), status: 'created' };
    });
  }

  async function getRoom(roomId: string) {
    const row = await db
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  async function roomIdExists(roomId: string): Promise<boolean> {
    const row = await db.selectFrom('rooms').select('id').where('id', '=', roomId).limit(1).executeTakeFirst();
    return Boolean(row);
  }

  async function updateRoom(roomId: string, { name = '' }: { name?: unknown } = {}, now: number = Date.now()) {
    const row = await db
      .updateTable('rooms')
      .set({ name: typeof name === 'string' ? name : '', updated_at: toDate(now) })
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  async function updateRoomAvatar(roomId: string, avatarKey: string | null = null, now: number = Date.now()) {
    const row = await db
      .updateTable('rooms')
      .set({ avatar_key: avatarKey || null, updated_at: toDate(now) })
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .where('is_static', '=', true)
      .returningAll()
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  async function swapRoomAvatar(roomId: string, avatarKey: string | null = null, now: number = Date.now()) {
    return db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('rooms')
        .select('avatar_key')
        .where('id', '=', roomId)
        .where('deleted_at', 'is', null)
        .where('is_static', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { previousAvatarKey: null, room: null };
      const row = await trx
        .updateTable('rooms')
        .set({ avatar_key: avatarKey || null, updated_at: toDate(now) })
        .where('id', '=', roomId)
        .returningAll()
        .executeTakeFirst();
      return { previousAvatarKey: current.avatar_key || null, room: mapRoomOrNull(row) };
    });
  }

  async function listAvatarKeys(): Promise<string[]> {
    const rows = await db
      .selectFrom('rooms')
      .select('avatar_key')
      .where('avatar_key', 'is not', null)
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map((row) => row.avatar_key).filter((key): key is string => Boolean(key));
  }

  async function deleteRoom(roomId: string, now: number = Date.now()) {
    const at = toDate(now);
    const row = await db
      .updateTable('rooms')
      .set((eb) => ({ deleted_at: eb.fn.coalesce('deleted_at', eb.val(at)), updated_at: at }))
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  async function markRoomActive(roomOrId: string | { id?: string } | null | undefined, now: number = Date.now()) {
    const roomId = roomIdFrom(roomOrId);
    if (!roomId) return null;
    const row = await db
      .updateTable('rooms')
      .set({ empty_since: null, updated_at: toDate(now) })
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  async function markRoomEmpty(roomOrId: string | { id?: string } | null | undefined, now: number = Date.now()) {
    const roomId = roomIdFrom(roomOrId);
    if (!roomId) return null;
    const at = toDate(now);
    const row = await db
      .updateTable('rooms')
      .set((eb) => ({ empty_since: eb.fn.coalesce('empty_since', eb.val(at)), updated_at: at }))
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapRoomOrNull(row);
  }

  function countRooms(): Promise<number> {
    return countLiveRooms(db);
  }

  function countQuotaRoomsForIp(creatorIp: unknown): Promise<number> {
    return countTemporaryRoomsForIp(db, typeof creatorIp === 'string' ? creatorIp : '');
  }

  async function countOwnedStaticRoomsForUser(userId: string | null | undefined): Promise<number> {
    if (!userId) return 0;
    return countOwnedStaticRooms(db, userId);
  }

  async function countEmptyRoomsForIp(creatorIp: unknown): Promise<number> {
    return countQuotaRoomsForIp(creatorIp);
  }

  async function pruneRooms(now: number = Date.now()): Promise<boolean> {
    const nowDate = toDate(now);
    const result = await db
      .updateTable('rooms')
      .set({ deleted_at: nowDate, updated_at: nowDate })
      .where('deleted_at', 'is', null)
      .where('is_static', '=', false)
      .where('empty_since', 'is not', null)
      .where('empty_since', '<=', toDate(now - roomIdleTtlMs))
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async function markActiveTemporaryRoomsEmpty(now: number = Date.now()) {
    const at = toDate(now);
    const result = await db
      .updateTable('rooms')
      .set({ empty_since: at, updated_at: at })
      .where('deleted_at', 'is', null)
      .where('is_static', '=', false)
      .where('empty_since', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async function listRoomsForOwner(ownerId: string | null | undefined) {
    if (!ownerId) return [];
    const rows = await db
      .selectFrom('room_memberships as rm')
      .innerJoin('rooms as r', 'r.id', 'rm.room_id')
      .selectAll('r')
      .where('rm.user_id', '=', ownerId)
      .where('rm.role', '=', 'owner')
      .where('r.deleted_at', 'is', null)
      .orderBy('r.created_at', 'desc')
      .execute();
    return rows.map(mapRoom);
  }

  // Deleted messages, rooms and stale guest identities leave for good once they
  // are older than the retention window, a bounded batch per call.
  async function purgeDeleted({
    olderThanMs = 30 * 24 * 60 * 60 * 1000,
    batchSize = 5000,
    now = Date.now()
  }: { olderThanMs?: number; batchSize?: number; now?: number } = {}) {
    const cutoff = toDate(now - normalizePositiveInt(olderThanMs, 30 * 24 * 60 * 60 * 1000));
    const limit = Math.max(1, normalizePositiveInt(batchSize, 5000));
    return db.transaction().execute(async (trx) => {
      // Attachments are the one reference that does not cascade. Unbind the ones
      // on messages that may go now, whether deleted on their own or with their
      // room, and mark them deleted so media cleanup removes the files.
      await trx
        .updateTable('message_attachments')
        .set((eb) => ({
          state: 'deleted',
          deleted_at: eb.fn.coalesce('deleted_at', sql<Date>`current_timestamp`),
          room_message_id: null,
          attachment_order: null,
          bound_at: null,
          updated_at: sql<Date>`current_timestamp`
        }))
        .where('room_message_id', 'in', (eb) =>
          eb
            .selectFrom('room_messages as m')
            .leftJoin('rooms as r', 'r.id', 'm.room_id')
            .select('m.id')
            .where((w) =>
              w.or([
                w.and([w('m.deleted_at', 'is not', null), w('m.deleted_at', '<', cutoff)]),
                w.and([w('r.deleted_at', 'is not', null), w('r.deleted_at', '<', cutoff)])
              ])
            )
        )
        .execute();
      const messages = await trx
        .deleteFrom('room_messages')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('room_messages')
            .select('id')
            .where('deleted_at', 'is not', null)
            .where('deleted_at', '<', cutoff)
            .orderBy('deleted_at', 'asc')
            .limit(limit)
        )
        .executeTakeFirst();
      const rooms = await trx
        .deleteFrom('rooms')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('rooms')
            .select('id')
            .where('deleted_at', 'is not', null)
            .where('deleted_at', '<', cutoff)
            .orderBy('deleted_at', 'asc')
            .limit(limit)
        )
        .executeTakeFirst();
      const identities = await trx
        .deleteFrom('room_peer_identities')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('room_peer_identities')
            .select('id')
            .where('last_seen_at', '<', cutoff)
            .orderBy('last_seen_at', 'asc')
            .limit(limit)
        )
        .executeTakeFirst();
      return {
        messages: Number(messages.numDeletedRows),
        rooms: Number(rooms.numDeletedRows),
        identities: Number(identities.numDeletedRows)
      };
    });
  }

  return {
    countEmptyRoomsForIp,
    countOwnedStaticRoomsForUser,
    countQuotaRoomsForIp,
    countRooms,
    createRoom,
    createRoomWithQuota,
    deleteRoom,
    getRoom,
    listAvatarKeys,
    listRoomsForOwner,
    markActiveTemporaryRoomsEmpty,
    markRoomActive,
    markRoomEmpty,
    pruneRooms,
    purgeDeleted,
    roomIdExists,
    swapRoomAvatar,
    updateRoom,
    updateRoomAvatar
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;
