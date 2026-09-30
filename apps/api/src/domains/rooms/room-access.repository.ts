// Who a room belongs to in someone's list: owner and member rows, bookmarks,
// the chat read cursor, and the recipient lists built from them.

import { sql } from 'kysely';
import type pg from 'pg';
import { transaction } from '../../platform/db/pool.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { ActiveBanService } from '../moderation/active-ban.service.ts';
import {
  createRowId,
  mapRoom,
  mapRoomOrNull,
  normalizePositiveInt,
  toDate,
  toMillis,
  type RoomRelationship,
  type StoredRoom
} from './room.repository.ts';

type BanChecks = Pick<ActiveBanService, 'isBanned' | 'filterEligibleUserIds'>;

function withRelationship(room: StoredRoom, relationship: unknown) {
  return { ...room, relationship: (relationship || '') as RoomRelationship };
}

// Messages count as unread after the reader's cursor; without a cursor, history
// from before the user joined is not unread. Their own messages never are.
function unreadMessages(db: Database, room: string | { ref: string }, userId: string, at: Date | 'now') {
  const query = db
    .selectFrom('room_messages as m')
    .leftJoin('room_chat_reads as rcr', (join) =>
      join.onRef('rcr.room_id', '=', 'm.room_id').on('rcr.user_id', '=', userId)
    )
    .leftJoin('room_memberships as rm', (join) =>
      join.onRef('rm.room_id', '=', 'm.room_id').on('rm.user_id', '=', userId)
    )
    .where('m.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([eb('m.expires_at', 'is', null), eb('m.expires_at', '>', at === 'now' ? sql<Date>`current_timestamp` : at)])
    )
    .where('m.created_at', '>', sql<Date>`COALESCE(rcr.last_read_at, rm.created_at, '-infinity'::timestamptz)`)
    .where(sql<boolean>`m.author_user_id IS DISTINCT FROM ${userId}`);
  return typeof room === 'string'
    ? query.where('m.room_id', '=', room)
    : query.where(sql<boolean>`m.room_id = ${sql.ref(room.ref)}`);
}

export function createRoomAccessRepository({ db, pool, bans }: { db: Database; pool: pg.Pool; bans: () => BanChecks }) {
  async function listVisibleRoomsForUser(userId: string | null | undefined) {
    if (!userId) return [];
    const owned = db
      .selectFrom('room_memberships as rm')
      .innerJoin('rooms as r', 'r.id', 'rm.room_id')
      .selectAll('r')
      .select([sql<string>`'owner'::text`.as('relationship'), sql<number>`1`.as('priority')])
      .where('rm.user_id', '=', userId)
      .where('rm.role', '=', 'owner')
      .where('r.is_static', '=', true)
      .where('r.deleted_at', 'is', null);
    const bookmarked = db
      .selectFrom('room_bookmarks as rb')
      .innerJoin('rooms as r', 'r.id', 'rb.room_id')
      .selectAll('r')
      .select([sql<string>`'bookmarked'::text`.as('relationship'), sql<number>`2`.as('priority')])
      .where('rb.user_id', '=', userId)
      .where('r.is_static', '=', true)
      .where('r.deleted_at', 'is', null);
    const rows = await db
      .with('visible', () => owned.unionAll(bookmarked))
      .with('deduped', (qb) =>
        qb
          .selectFrom('visible')
          .distinctOn('id')
          .selectAll()
          .orderBy('id')
          .orderBy('priority', 'asc')
          .orderBy('created_at', 'desc')
      )
      .selectFrom('deduped')
      .selectAll('deduped')
      .select((eb) => [
        eb
          .selectFrom('room_messages as m')
          .select((inner) => inner.fn.max('m.created_at').as('max'))
          .whereRef('m.room_id', '=', 'deduped.id')
          .where('m.deleted_at', 'is', null)
          .where((w) => w.or([w('m.expires_at', 'is', null), w('m.expires_at', '>', sql<Date>`current_timestamp`)]))
          .as('last_message_at'),
        unreadMessages(db, { ref: 'deduped.id' }, userId, 'now')
          .select(sql<number>`COUNT(*)::int`.as('count'))
          .as('unread_count')
      ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((row) =>
      withRelationship(
        mapRoom({ ...row, last_message_at: row.last_message_at ?? null, unread_count: row.unread_count ?? 0 }),
        row.relationship
      )
    );
  }

  async function getRoomUnreadCount(roomId: string, userId: string, now: number = Date.now()): Promise<number> {
    if (!roomId || !userId) return 0;
    const row = await unreadMessages(db, roomId, userId, toDate(now))
      .select(sql<number>`COUNT(*)::int`.as('unread_count'))
      .executeTakeFirst();
    return normalizePositiveInt(row?.unread_count, 0);
  }

  // Only someone who has the room in their list keeps a read cursor for it.
  async function markRoomChatRead(roomId: string, userId: string, now: number = Date.now()): Promise<number | null> {
    if (!roomId || !userId) return null;
    const row = await db
      .insertInto('room_chat_reads')
      .columns(['room_id', 'user_id', 'last_read_at'])
      .expression((eb) =>
        eb
          .selectFrom('rooms as r')
          .select([
            'r.id',
            sql<string>`${userId}::varchar(36)`.as('user_id'),
            sql<Date>`${toDate(now)}::timestamptz`.as('at')
          ])
          .where('r.id', '=', sql<string>`${roomId}::varchar(48)`)
          .where('r.deleted_at', 'is', null)
          .where((w) =>
            w.or([
              w.exists(
                w
                  .selectFrom('room_memberships as rm')
                  .select(sql`1`.as('one'))
                  .whereRef('rm.room_id', '=', 'r.id')
                  .where('rm.user_id', '=', sql<string>`${userId}::varchar(36)`)
                  .where('rm.role', '=', 'owner')
              ),
              w.exists(
                w
                  .selectFrom('room_bookmarks as rb')
                  .select(sql`1`.as('one'))
                  .whereRef('rb.room_id', '=', 'r.id')
                  .where('rb.user_id', '=', sql<string>`${userId}::varchar(36)`)
              )
            ])
          )
      )
      .onConflict((oc) =>
        oc.columns(['room_id', 'user_id']).doUpdateSet({
          last_read_at: sql<Date>`GREATEST(room_chat_reads.last_read_at, EXCLUDED.last_read_at)`
        })
      )
      .returning('last_read_at')
      .executeTakeFirst();
    return row?.last_read_at ? toMillis(row.last_read_at) : null;
  }

  async function canUserReadRoomChat(roomId: string, userId: string): Promise<boolean> {
    if (!roomId || !userId) return false;
    const row = await db
      .selectFrom('rooms as r')
      .select('r.id')
      .where('r.id', '=', roomId)
      .where('r.deleted_at', 'is', null)
      .where((w) =>
        w.or([
          w.exists(
            w
              .selectFrom('room_memberships as rm')
              .select('rm.id')
              .whereRef('rm.room_id', '=', 'r.id')
              .where('rm.user_id', '=', userId)
          ),
          w.exists(
            w
              .selectFrom('room_bookmarks as rb')
              .select('rb.id')
              .whereRef('rb.room_id', '=', 'r.id')
              .where('rb.user_id', '=', userId)
          )
        ])
      )
      .limit(1)
      .executeTakeFirst();
    return Boolean(row) && !(await bans().isBanned({ roomId, userId }));
  }

  async function canUserReactInRoom(roomId: string, userId: string): Promise<boolean> {
    if (!roomId || !userId) return false;
    const row = await db
      .selectFrom('rooms as r')
      .innerJoin('room_memberships as rm', (join) =>
        join.onRef('rm.room_id', '=', 'r.id').on('rm.user_id', '=', userId)
      )
      .select('r.id')
      .where('r.id', '=', roomId)
      .where('r.deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row) && !(await bans().isBanned({ roomId, userId }));
  }

  async function recipients(roomId: string, { ownersOnly, staticOnly }: { ownersOnly: boolean; staticOnly: boolean }) {
    let members = db
      .selectFrom('room_memberships as rm')
      .innerJoin('rooms as r', 'r.id', 'rm.room_id')
      .select('rm.user_id')
      .where('rm.room_id', '=', roomId)
      .where('r.deleted_at', 'is', null);
    if (ownersOnly) members = members.where('rm.role', '=', 'owner');
    if (staticOnly) members = members.where('r.is_static', '=', true);
    let bookmarked = db
      .selectFrom('room_bookmarks as rb')
      .innerJoin('rooms as r', 'r.id', 'rb.room_id')
      .select('rb.user_id')
      .where('rb.room_id', '=', roomId)
      .where('r.deleted_at', 'is', null);
    if (staticOnly) bookmarked = bookmarked.where('r.is_static', '=', true);
    const rows = await db
      .with('recipients', () => members.unionAll(bookmarked))
      .selectFrom('recipients')
      .select('user_id')
      .distinct()
      .execute();
    return bans().filterEligibleUserIds({ roomId, userIds: rows.map((row) => row.user_id).filter(Boolean) });
  }

  // The room's owner and whoever keeps it in their list see its lobby summary.
  async function listSummaryRecipientUserIds(roomId: string) {
    if (!roomId) return [];
    return recipients(roomId, { ownersOnly: true, staticOnly: false });
  }

  // Every member hears about room messages, not only the owner.
  async function listNotificationRecipientUserIds(roomId: string) {
    if (!roomId) return [];
    return recipients(roomId, { ownersOnly: false, staticOnly: true });
  }

  async function isOwner(trx: Database, roomId: string, userId: string): Promise<boolean> {
    const row = await trx
      .selectFrom('room_memberships')
      .select('id')
      .where('room_id', '=', roomId)
      .where('user_id', '=', userId)
      .where('role', '=', 'owner')
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function addRoomBookmarkForUser(userId: string, roomId: string, now: number = Date.now()) {
    if (!userId || !roomId) return { room: null, status: 'not_found' };
    return transaction(pool, async (client) => {
      const trx = kyselyOn(client);
      const room = mapRoomOrNull(
        await trx
          .selectFrom('rooms')
          .selectAll()
          .where('id', '=', roomId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      );
      if (!room) return { room: null, status: 'not_found' };
      if (!room.isStatic) return { room: null, status: 'temporary_room' };

      const at = toDate(now);
      await trx
        .insertInto('room_bookmarks')
        .values({ id: createRowId(), room_id: room.id, user_id: userId, created_at: at, updated_at: at })
        .onConflict((oc) =>
          oc.columns(['user_id', 'room_id']).doUpdateSet((eb) => ({ updated_at: eb.ref('excluded.updated_at') }))
        )
        .execute();

      const owner = await isOwner(trx, room.id, userId);
      // Adding a room to the list makes the user a member, like joining it does.
      if (!owner && !(await bans().isBanned({ roomId: room.id, userId, at: now, client }))) {
        await trx
          .insertInto('room_memberships')
          .values({
            id: createRowId(),
            room_id: room.id,
            user_id: userId,
            role: 'member',
            created_at: at,
            updated_at: at
          })
          .onConflict((oc) => oc.columns(['room_id', 'user_id']).doNothing())
          .execute();
      }
      return { room: withRelationship(room, owner ? 'owner' : 'bookmarked'), status: 'bookmarked' };
    });
  }

  async function removeRoomBookmarkForUser(userId: string | null | undefined, roomId: string | null | undefined) {
    if (!userId || !roomId) return { removed: false, status: 'not_found' };
    return db.transaction().execute(async (trx) => {
      if (await isOwner(trx, roomId, userId)) return { removed: false, status: 'owner' };
      const removed = await trx
        .deleteFrom('room_bookmarks')
        .where('room_id', '=', roomId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      // Removing the room from the list also ends the (non-owner) membership.
      await trx
        .deleteFrom('room_memberships')
        .where('room_id', '=', roomId)
        .where('user_id', '=', userId)
        .where('role', '=', 'member')
        .execute();
      return { removed: removed.numDeletedRows > 0n, status: 'removed' };
    });
  }

  return {
    addRoomBookmarkForUser,
    canUserReactInRoom,
    canUserReadRoomChat,
    getRoomUnreadCount,
    listNotificationRecipientUserIds,
    listSummaryRecipientUserIds,
    listVisibleRoomsForUser,
    markRoomChatRead,
    removeRoomBookmarkForUser
  };
}

export type RoomAccessRepository = ReturnType<typeof createRoomAccessRepository>;
