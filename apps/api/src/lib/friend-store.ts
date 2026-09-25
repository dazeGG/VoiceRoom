import crypto from 'node:crypto';
import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import type pg from 'pg';
import { transaction } from '../platform/db/pool.ts';
import { kyselyOn, type Database, type Queryable } from '../platform/db/kysely.ts';
import { cleanAvatarColorKey, cleanPresenceStatus } from '@voice-room/shared/validation';
import { normalizeLinkPreview, type LinkPreview } from '@voice-room/shared/link-preview';
import type { DB, DirectMessages, Users } from '../platform/db/schema.ts';

type Metadata = Record<string, unknown>;
type UserRow = Pick<
  Selectable<Users>,
  | 'avatar_accent'
  | 'avatar_color_key'
  | 'avatar_key'
  | 'created_at'
  | 'display_name'
  | 'dnd'
  | 'id'
  | 'login'
  | 'presence_status'
>;
export type PublicUser = ReturnType<typeof mapPublicUser> & object;

export type DirectMessageInvite = {
  roomId: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: number | null;
};

/** A direct message as stored; deletedAt stays internal, callers filter on it. */
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: number | null;
  editedAt: number | null;
  readAt: number | null;
  invite: DirectMessageInvite | null;
  linkPreview: LinkPreview | undefined;
  replyTo: { messageId: string } | undefined;
  deletedAt: number | null;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

// Public shape for a user row joined from the `users` table (snake_case). Never
// leaks the password hash; mirrors user-store's publicUser fields.
function mapPublicUser(row: UserRow) {
  const presenceStatus = cleanPresenceStatus(row.presence_status) || (row.dnd ? 'dnd' : 'online');
  return {
    avatarAccent: row.avatar_accent || null,
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    doNotDisturb: presenceStatus === 'dnd',
    id: row.id,
    login: row.login,
    presenceStatus
  };
}

// Room invitations ride inside a regular direct message's metadata so they
// live in the shared thread history without any schema change.
function mapInvite(metadata: Metadata | null | undefined): DirectMessageInvite | null {
  if (!metadata || metadata.kind !== 'room-invite') return null;
  const status = metadata.status;
  return {
    roomId: typeof metadata.roomId === 'string' ? metadata.roomId : '',
    roomName: typeof metadata.roomName === 'string' ? metadata.roomName : '',
    status: status === 'accepted' || status === 'declined' || status === 'expired' ? status : 'pending',
    expiresAt: Number(metadata.expiresAt) || null
  };
}

function mapMessage(row: Selectable<DirectMessages>): DirectMessage;
function mapMessage(row: Selectable<DirectMessages> | null | undefined): DirectMessage | null;
function mapMessage(row: Selectable<DirectMessages> | null | undefined): DirectMessage | null {
  if (!row) return null;
  const metadata = row.metadata as Metadata | null;
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: toMillis(row.created_at),
    editedAt: toMillis(row.edited_at),
    readAt: toMillis(row.read_at),
    invite: mapInvite(metadata),
    linkPreview: normalizeLinkPreview(metadata?.linkPreview) || undefined,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined,
    // deletedAt kept internal; callers filter before map
    deletedAt: row.deleted_at ? toMillis(row.deleted_at) : null
  };
}

// friendships store the pair ordered so a single row is canonical.
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function lockUserPair(q: Database, a: string, b: string): Promise<void> {
  const [low, high] = orderedPair(a, b);
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:user-pair:${low}:${high}`}))`.execute(q);
}

// Escape LIKE wildcards in user-supplied search terms (we use ESCAPE '\').
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const now = sql<Date>`current_timestamp`;

// The other side of a friendship row, seen from `userId`.
function friendOf(userId: string) {
  return sql<string>`CASE WHEN user_a_id = ${userId} THEN user_b_id ELSE user_a_id END`;
}

// Messages between two users, either direction.
function between(a: string, b: string) {
  return (eb: ExpressionBuilder<DB, 'direct_messages'>) =>
    eb.or([
      eb.and([eb('sender_id', '=', a), eb('recipient_id', '=', b)]),
      eb.and([eb('sender_id', '=', b), eb('recipient_id', '=', a)])
    ]);
}

// Invitation state lives in the message's metadata JSON.
const inviteKind = sql<string>`metadata->>'kind'`;
const inviteStatus = sql<string>`metadata->>'status'`;

function createFriendStore({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const on = (client?: Queryable): Database => (client ? kyselyOn(client) : db);

  // --- Friendship lookups -------------------------------------------------

  async function getFriendIds(userId: string, client?: Queryable): Promise<string[]> {
    const rows = await on(client)
      .selectFrom('friendships')
      .select(friendOf(userId).as('friend_id'))
      .where((eb) => eb.or([eb('user_a_id', '=', userId), eb('user_b_id', '=', userId)]))
      .execute();
    return rows.map((row) => row.friend_id);
  }

  async function friendsOn(q: Database, a: string, b: string): Promise<boolean> {
    const [low, high] = orderedPair(a, b);
    const row = await q
      .selectFrom('friendships')
      .select('id')
      .where('user_a_id', '=', low)
      .where('user_b_id', '=', high)
      .executeTakeFirst();
    return Boolean(row);
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

    const unread = new Map(Object.entries(await getUnreadCounts(userId)));

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

  // --- Requests -----------------------------------------------------------

  function setRequestStatus(q: Database, requestId: string, status: 'accepted' | 'declined' | 'cancelled') {
    return q.updateTable('friend_requests').set({ status, responded_at: now }).where('id', '=', requestId).execute();
  }

  async function insertFriendship(q: Database, a: string, b: string): Promise<void> {
    const [low, high] = orderedPair(a, b);
    await q
      .insertInto('friendships')
      .values({ id: crypto.randomUUID(), user_a_id: low, user_b_id: high, created_at: now })
      .onConflict((oc) => oc.columns(['user_a_id', 'user_b_id']).doNothing())
      .execute();
  }

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

  // --- Blocks -------------------------------------------------------------

  async function blockedOn(q: Database, a: string, b: string): Promise<boolean> {
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

  // --- Direct messages ----------------------------------------------------

  async function listThread({ userId, peerId, limit = 100 }: { userId: string; peerId: string; limit?: number }) {
    const rows = await db
      .selectFrom('direct_messages')
      .selectAll()
      .where(between(userId, peerId))
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows.map((row) => mapMessage(row));
  }

  async function getMessage(userId: string, peerId: string, messageId: string) {
    const row = await db
      .selectFrom('direct_messages')
      .selectAll()
      .where('id', '=', messageId)
      .where(between(userId, peerId))
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return mapMessage(row);
  }

  async function softDeleteMessage(messageId: string): Promise<boolean> {
    const result = await db
      .updateTable('direct_messages')
      .set({ deleted_at: sql<Date>`now()` })
      .where('id', '=', messageId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async function editMessage({
    messageId,
    senderId,
    recipientId,
    body
  }: {
    messageId: string;
    senderId: string;
    recipientId: string;
    body: string;
  }) {
    const row = await db
      .updateTable('direct_messages')
      .set({ body, edited_at: now })
      .where('id', '=', messageId)
      .where('sender_id', '=', senderId)
      .where('recipient_id', '=', recipientId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapMessage(row);
  }

  async function sendMessage({
    senderId,
    recipientId,
    body,
    metadata = null,
    replyToMessageId = null,
    beforeUnitOfWork = null,
    unitOfWork = null
  }: {
    senderId: string;
    recipientId: string;
    body: string;
    metadata?: Metadata | null;
    replyToMessageId?: string | null;
    beforeUnitOfWork?:
      ((client: pg.PoolClient) => Promise<{ replay?: boolean; message?: unknown } | null | undefined>) | null;
    unitOfWork?: ((client: pg.PoolClient, message: DirectMessage) => Promise<unknown>) | null;
  }) {
    const id = crypto.randomUUID();
    // A raw pg transaction: the hooks run their own SQL on the same client.
    return transaction(pool, async (client) => {
      if (typeof beforeUnitOfWork === 'function') {
        const prepared = await beforeUnitOfWork(client);
        if (prepared?.replay) return { ...(prepared.message as DirectMessage), idempotencyReplay: true };
      }
      const row = await kyselyOn(client)
        .insertInto('direct_messages')
        .values({
          id,
          sender_id: senderId,
          recipient_id: recipientId,
          body,
          created_at: now,
          metadata: metadata ? JSON.stringify(metadata) : '{}',
          reply_to_message_id: replyToMessageId
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const message = mapMessage(row);
      if (typeof unitOfWork === 'function') await unitOfWork(client, message);
      return message;
    });
  }

  // Only the invited recipient may resolve a pending room invitation; the
  // update is idempotent-safe (a second respond finds no pending row).
  async function respondInvite({
    messageId,
    recipientId,
    status
  }: {
    messageId: string;
    recipientId: string;
    status: string;
  }) {
    const row = await db
      .updateTable('direct_messages')
      .set({ metadata: sql`jsonb_set(metadata, '{status}', to_jsonb(${status}::text))` })
      .where('id', '=', messageId)
      .where('recipient_id', '=', recipientId)
      .where(inviteKind, '=', 'room-invite')
      .where(inviteStatus, '=', 'pending')
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return mapMessage(row);
  }

  // Expires pending invitations for a room. Omitting senderId expires every
  // sender's invitations, which is what a deleted room needs.
  async function expirePendingInvites({ senderId = null, roomId }: { senderId?: string | null; roomId: string }) {
    let query = db
      .updateTable('direct_messages')
      .set({ metadata: sql`jsonb_set(metadata, '{status}', to_jsonb('expired'::text))` })
      .where(inviteKind, '=', 'room-invite')
      .where(sql<string>`metadata->>'roomId'`, '=', roomId)
      .where(inviteStatus, '=', 'pending')
      .where('deleted_at', 'is', null);
    if (senderId) query = query.where('sender_id', '=', senderId);
    const rows = await query.returningAll().execute();
    return rows.map((row) => mapMessage(row));
  }

  // Mark every message from peer -> user as read. Returns the number marked so
  // the caller can decide whether to broadcast a read receipt.
  async function markRead({ userId, peerId }: { userId: string; peerId: string }) {
    const result = await db
      .updateTable('direct_messages')
      .set({ read_at: now })
      .where('recipient_id', '=', userId)
      .where('sender_id', '=', peerId)
      .where('read_at', 'is', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return { count: Number(result.numUpdatedRows) };
  }

  async function getUnreadCounts(userId: string): Promise<Record<string, number>> {
    const rows = await db
      .selectFrom('direct_messages')
      .select(['sender_id', sql<number>`COUNT(*)::int`.as('count')])
      .where('recipient_id', '=', userId)
      .where('read_at', 'is', null)
      .where('deleted_at', 'is', null)
      .groupBy('sender_id')
      .execute();
    return Object.fromEntries(rows.map((row) => [row.sender_id, row.count]));
  }

  return {
    areFriends,
    blockUser,
    cancelRequest,
    isBlockedBetween,
    listBlockedUserIds,
    listBlockedUsers,
    unblockUser,
    countIncomingRequests,
    expirePendingInvites,
    getFriendIds,
    getUnreadCounts,
    editMessage,
    listFriends,
    listRequests,
    listThread,
    getMessage,
    softDeleteMessage,
    markRead,
    removeFriend,
    respondInvite,
    respondRequest,
    searchUsers,
    sendMessage,
    sendRequest
  };
}

export type FriendStore = ReturnType<typeof createFriendStore>;

export { createFriendStore, mapPublicUser, mapMessage, orderedPair };
