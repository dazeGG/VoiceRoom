// Friend requests: sending, answering and cancelling one (accepting makes a
// friendship; a block on either side refuses it).

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { lockUserPair, mapPublicUser, now, toMillis } from './social-records.ts';
import { friendsOn, insertFriendship } from './friendship.repository.ts';
import { blockedOn } from './user-block.repository.ts';

// --- Requests -----------------------------------------------------------
export function setRequestStatus(q: Database, requestId: string, status: 'accepted' | 'declined' | 'cancelled') {
  return q.updateTable('friend_requests').set({ status, responded_at: now }).where('id', '=', requestId).execute();
}

export function createFriendRequestRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  // Send a friend request to a login or explicit user id. Auto-accepts when a
  // reverse pending request already exists, so two people who request each
  // other become friends without an extra accept step. Returns a discriminated
  // status. The user-id path supports in-room social actions without exposing
  // logins in room presence payloads.
  async function sendRequest({
    requesterId,
    addresseeLogin = '',
    addresseeUserId = ''
  }: {
    requesterId: string;
    addresseeLogin?: string;
    addresseeUserId?: string;
  }) {
    return db.transaction().execute(async (trx) => {
      const addressee = await trx
        .selectFrom('users')
        .selectAll()
        .where(addresseeUserId ? 'id' : 'login', '=', addresseeUserId || addresseeLogin)
        .executeTakeFirst();
      // Deleted and soon-to-be-deleted accounts cannot be found or befriended.
      if (!addressee || addressee.deletion_requested_at || addressee.deleted_at)
        return { status: 'not_found' as const };
      if (addressee.id === requesterId) return { status: 'self' as const };

      await lockUserPair(trx, requesterId, addressee.id);

      // A block in either direction stops the request. The status is the same
      // for both directions so the sender cannot probe whether they were the
      // one blocked.
      if (await blockedOn(trx, requesterId, addressee.id)) {
        return { status: 'blocked' as const };
      }

      if (await friendsOn(trx, requesterId, addressee.id)) {
        return { status: 'already_friends' as const, user: mapPublicUser(addressee) };
      }

      const pending = (from: string, to: string) =>
        trx
          .selectFrom('friend_requests')
          .select('id')
          .where('requester_id', '=', from)
          .where('addressee_id', '=', to)
          .where('status', '=', 'pending');

      // Reverse pending request -> accept it.
      const reverse = await pending(addressee.id, requesterId).forUpdate().executeTakeFirst();
      if (reverse) {
        await setRequestStatus(trx, reverse.id, 'accepted');
        await insertFriendship(trx, requesterId, addressee.id);
        return { status: 'accepted' as const, user: mapPublicUser(addressee) };
      }

      // Existing forward pending request -> idempotent.
      if (await pending(requesterId, addressee.id).executeTakeFirst()) {
        return { status: 'already_sent' as const, user: mapPublicUser(addressee) };
      }

      // The pre-check above is racy under READ COMMITTED: two concurrent sends
      // (double-click, two tabs) both pass it, then collide on the partial
      // unique index `friend_requests_pending_unique_idx`. ON CONFLICT over that
      // index's predicate makes the loser a no-op so we return an idempotent
      // already_sent instead of bubbling a 23505 up as a 500.
      const id = crypto.randomUUID();
      const inserted = await trx
        .insertInto('friend_requests')
        .values({ id, requester_id: requesterId, addressee_id: addressee.id, status: 'pending', created_at: now })
        .onConflict((oc) => oc.columns(['requester_id', 'addressee_id']).where('status', '=', 'pending').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) {
        return { status: 'already_sent' as const, user: mapPublicUser(addressee) };
      }
      return { status: 'sent' as const, requestId: id, user: mapPublicUser(addressee) };
    });
  }

  // Pending incoming + outgoing requests, each joined with the other user and a
  // count of mutual friends (used by the design's "N общих друга" line).
  async function listRequests(userId: string) {
    const incoming = await db
      .selectFrom('friend_requests as fr')
      .innerJoin('users as u', 'u.id', 'fr.requester_id')
      .selectAll('u')
      .select([
        'fr.id as request_id',
        'fr.created_at as request_created_at',
        sql<number>`(
          SELECT COUNT(*)::int FROM friendships fa
          JOIN friendships fb
            ON (CASE WHEN fb.user_a_id = u.id THEN fb.user_b_id ELSE fb.user_a_id END)
             = (CASE WHEN fa.user_a_id = ${userId} THEN fa.user_b_id ELSE fa.user_a_id END)
          WHERE (fa.user_a_id = ${userId} OR fa.user_b_id = ${userId})
            AND (fb.user_a_id = u.id OR fb.user_b_id = u.id)
        )`.as('mutual')
      ])
      .where('fr.addressee_id', '=', userId)
      .where('fr.status', '=', 'pending')
      .orderBy('fr.created_at', 'desc')
      .execute();
    const outgoing = await db
      .selectFrom('friend_requests as fr')
      .innerJoin('users as u', 'u.id', 'fr.addressee_id')
      .selectAll('u')
      .select(['fr.id as request_id', 'fr.created_at as request_created_at'])
      .where('fr.requester_id', '=', userId)
      .where('fr.status', '=', 'pending')
      .orderBy('fr.created_at', 'desc')
      .execute();
    return {
      incoming: incoming.map((row) => ({
        id: row.request_id,
        createdAt: toMillis(row.request_created_at),
        mutualFriends: row.mutual || 0,
        user: mapPublicUser(row)
      })),
      outgoing: outgoing.map((row) => ({
        id: row.request_id,
        createdAt: toMillis(row.request_created_at),
        user: mapPublicUser(row)
      }))
    };
  }

  async function countIncomingRequests(userId: string): Promise<number> {
    const row = await db
      .selectFrom('friend_requests')
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .where('addressee_id', '=', userId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return row?.count || 0;
  }

  // Accept or decline an incoming request the user owns (addressee).
  async function respondRequest({ userId, requestId, action }: { userId: string; requestId: string; action: string }) {
    return db.transaction().execute(async (trx) => {
      const pendingRequest = () =>
        trx
          .selectFrom('friend_requests')
          .select('requester_id')
          .where('id', '=', requestId)
          .where('addressee_id', '=', userId)
          .where('status', '=', 'pending');
      const candidate = await pendingRequest().executeTakeFirst();
      if (!candidate) return { status: 'not_found' as const };

      await lockUserPair(trx, userId, candidate.requester_id);
      const request = await pendingRequest().forUpdate().executeTakeFirst();
      if (!request) return { status: 'not_found' as const };

      if (action === 'accept') {
        if (await blockedOn(trx, userId, request.requester_id)) {
          await setRequestStatus(trx, requestId, 'cancelled');
          return { status: 'blocked' as const, requesterId: request.requester_id };
        }
        await setRequestStatus(trx, requestId, 'accepted');
        await insertFriendship(trx, userId, request.requester_id);
        const requester = await trx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', request.requester_id)
          .executeTakeFirstOrThrow();
        return { status: 'accepted' as const, requesterId: request.requester_id, user: mapPublicUser(requester) };
      }

      await setRequestStatus(trx, requestId, 'declined');
      return { status: 'declined' as const, requesterId: request.requester_id };
    });
  }

  // Cancel an outgoing request the user sent (requester).
  async function cancelRequest({ userId, requestId }: { userId: string; requestId: string }) {
    const row = await db
      .updateTable('friend_requests')
      .set({ status: 'cancelled', responded_at: now })
      .where('id', '=', requestId)
      .where('requester_id', '=', userId)
      .where('status', '=', 'pending')
      .returning('addressee_id')
      .executeTakeFirst();
    if (!row) return { status: 'not_found' as const };
    return { status: 'cancelled' as const, addresseeId: row.addressee_id };
  }

  return { sendRequest, listRequests, countIncomingRequests, respondRequest, cancelRequest };
}
