// Friendships: who is whose friend, the friend list with each thread's last
// message and unread count, user search, and ending a friendship.

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database, type Queryable } from '../../platform/db/kysely.ts';
import { escapeLike, friendOf, mapPublicUser, now, orderedPair, toMillis } from './social-records.ts';
import { unreadCountsFor } from '../messaging/dm-thread.repository.ts';

export async function friendsOn(q: Database, a: string, b: string): Promise<boolean> {
  const [low, high] = orderedPair(a, b);
  const row = await q
    .selectFrom('friendships')
    .select('id')
    .where('user_a_id', '=', low)
    .where('user_b_id', '=', high)
    .executeTakeFirst();
  return Boolean(row);
}

export async function insertFriendship(q: Database, a: string, b: string): Promise<void> {
  const [low, high] = orderedPair(a, b);
  await q
    .insertInto('friendships')
    .values({ id: crypto.randomUUID(), user_a_id: low, user_b_id: high, created_at: now })
    .onConflict((oc) => oc.columns(['user_a_id', 'user_b_id']).doNothing())
    .execute();
}

export function createFriendshipRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const on = (client?: Queryable): Database => (client ? kyselyOn(client) : db);

  async function getFriendIds(userId: string, client?: Queryable): Promise<string[]> {
    const rows = await on(client)
      .selectFrom('friendships')
      .select(friendOf(userId).as('friend_id'))
      .where((eb) => eb.or([eb('user_a_id', '=', userId), eb('user_b_id', '=', userId)]))
      .execute();
    return rows.map((row) => row.friend_id);
  }

  function areFriends(a: string, b: string, client?: Queryable): Promise<boolean> {
    return friendsOn(on(client), a, b);
  }

  // Friend list enriched with the last DM and unread count, ready for the
  // sidebar/home. Online status is layered on at the route level from the
  // in-memory presence registry.
  async function listFriends(userId: string) {
    const friends = await db
      .selectFrom('friendships as f')
      .innerJoin('users as u', (join) =>
        join.on(sql<boolean>`u.id = CASE WHEN f.user_a_id = ${userId} THEN f.user_b_id ELSE f.user_a_id END`)
      )
      .selectAll('u')
      .select('f.created_at as friends_since')
      .where((eb) => eb.or([eb('f.user_a_id', '=', userId), eb('f.user_b_id', '=', userId)]))
      .orderBy(sql`lower(coalesce(u.display_name, u.login))`)
      .execute();

    const unread = new Map(Object.entries(await unreadCountsFor(db, userId)));

    const last = await db
      .selectFrom((eb) =>
        eb
          .selectFrom('direct_messages')
          .select([
            sql<string>`CASE WHEN sender_id = ${userId} THEN recipient_id ELSE sender_id END`.as('peer'),
            'id',
            'body',
            'created_at',
            'sender_id'
          ])
          .where((w) => w.or([w('sender_id', '=', userId), w('recipient_id', '=', userId)]))
          .where('deleted_at', 'is', null)
          .as('t')
      )
      .distinctOn('peer')
      .selectAll()
      .orderBy('peer')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const lastMessage = new Map(
      last.map((row) => [
        row.peer,
        { id: row.id, body: row.body, createdAt: toMillis(row.created_at), fromMe: row.sender_id === userId }
      ])
    );

    return friends.map((row) => ({
      user: mapPublicUser(row),
      friendsSince: toMillis(row.friends_since),
      unreadCount: unread.get(row.id) || 0,
      lastMessage: lastMessage.get(row.id) || null
    }));
  }

  // --- Search -------------------------------------------------------------
  async function searchUsers({
    query,
    excludeUserId,
    limit = 20
  }: {
    query: unknown;
    excludeUserId: string;
    limit?: number;
  }) {
    const term = typeof query === 'string' ? query.trim() : '';
    if (!term) return [];
    const pattern = `%${escapeLike(term.toLowerCase())}%`;
    const rows = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '<>', excludeUserId)
      .where('deletion_requested_at', 'is', null)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          sql<boolean>`lower(login) LIKE ${pattern} ESCAPE '\\'`,
          sql<boolean>`lower(display_name) LIKE ${pattern} ESCAPE '\\'`
        ])
      )
      .orderBy(sql`lower(login)`)
      .limit(limit)
      .execute();
    return rows.map(mapPublicUser);
  }

  async function removeFriend({ userId, friendId }: { userId: string; friendId: string }) {
    const [low, high] = orderedPair(userId, friendId);
    const result = await db
      .deleteFrom('friendships')
      .where('user_a_id', '=', low)
      .where('user_b_id', '=', high)
      .executeTakeFirst();
    if (result.numDeletedRows === 0n) return { status: 'not_found' as const };
    return { status: 'removed' as const };
  }

  return { getFriendIds, areFriends, listFriends, searchUsers, removeFriend };
}
