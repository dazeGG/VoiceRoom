// Blocks: a block ends the friendship and hides each side from the other.

import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database, type Queryable } from '../../platform/db/kysely.ts';
import { between, inviteKind, inviteStatus, lockUserPair, mapPublicUser, now, orderedPair } from './social-records.ts';

// --- Blocks -------------------------------------------------------------
export async function blockedOn(q: Database, a: string, b: string): Promise<boolean> {
  const row = await q
    .selectFrom('user_blocks')
    .select('blocker_id')
    .where((eb) =>
      eb.or([
        eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]),
        eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)])
      ])
    )
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

export function createUserBlockRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const on = (client?: Queryable): Database => (client ? kyselyOn(client) : db);

  // A block is directed, but every enforcement point treats an edge in either
  // direction as a stop, so this is the single predicate callers should use.
  async function isBlockedBetween(
    a: string | null | undefined,
    b: string | null | undefined,
    client?: Queryable
  ): Promise<boolean> {
    if (!a || !b || a === b) return false;
    return blockedOn(on(client), a, b);
  }

  async function listBlockedUserIds(userId: string, client?: Queryable): Promise<string[]> {
    const rows = await on(client)
      .selectFrom('user_blocks')
      .select('blocked_id')
      .where('blocker_id', '=', userId)
      .execute();
    return rows.map((row) => row.blocked_id);
  }

  async function listBlockedUsers(userId: string, client?: Queryable) {
    const rows = await on(client)
      .selectFrom('user_blocks as b')
      .innerJoin('users as u', 'u.id', 'b.blocked_id')
      .selectAll('u')
      .where('b.blocker_id', '=', userId)
      .orderBy(sql`lower(coalesce(u.display_name, u.login))`)
      .orderBy('u.id')
      .execute();
    return rows.map(mapPublicUser);
  }

  // Blocking is a hard reset of the relationship: the friendship goes away and
  // any pending request in either direction is cancelled, so unblocking later
  // starts from a clean slate rather than silently restoring contact.
  async function blockUser({ userId, targetId }: { userId: string; targetId: string }) {
    if (!targetId || userId === targetId) return { status: 'invalid' as const };
    return db.transaction().execute(async (trx) => {
      await lockUserPair(trx, userId, targetId);
      const exists = await trx.selectFrom('users').select('id').where('id', '=', targetId).executeTakeFirst();
      if (!exists) return { status: 'not_found' as const };

      const inserted = await trx
        .insertInto('user_blocks')
        .values({ blocker_id: userId, blocked_id: targetId })
        .onConflict((oc) => oc.columns(['blocker_id', 'blocked_id']).doNothing())
        .executeTakeFirst();

      const [low, high] = orderedPair(userId, targetId);
      const unfriended = await trx
        .deleteFrom('friendships')
        .where('user_a_id', '=', low)
        .where('user_b_id', '=', high)
        .executeTakeFirst();
      await trx
        .updateTable('friend_requests')
        .set({ status: 'cancelled', responded_at: now })
        .where('status', '=', 'pending')
        .where((eb) =>
          eb.or([
            eb.and([eb('requester_id', '=', userId), eb('addressee_id', '=', targetId)]),
            eb.and([eb('requester_id', '=', targetId), eb('addressee_id', '=', userId)])
          ])
        )
        .execute();
      await trx
        .updateTable('direct_messages')
        .set({
          metadata: sql`jsonb_set(metadata, '{status}', '"expired"'::jsonb, true)`,
          edited_at: now
        })
        .where(inviteKind, '=', 'room-invite')
        .where(inviteStatus, '=', 'pending')
        .where(between(userId, targetId))
        .execute();

      return {
        status:
          Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0 ? ('blocked' as const) : ('already_blocked' as const),
        unfriended: unfriended.numDeletedRows > 0n
      };
    });
  }

  async function unblockUser({ userId, targetId }: { userId: string; targetId: string }) {
    if (!targetId || userId === targetId) return { status: 'invalid' as const };
    return db.transaction().execute(async (trx) => {
      await lockUserPair(trx, userId, targetId);
      const result = await trx
        .deleteFrom('user_blocks')
        .where('blocker_id', '=', userId)
        .where('blocked_id', '=', targetId)
        .executeTakeFirst();
      return { status: result.numDeletedRows > 0n ? ('unblocked' as const) : ('not_found' as const) };
    });
  }

  return { isBlockedBetween, listBlockedUserIds, listBlockedUsers, blockUser, unblockUser };
}
