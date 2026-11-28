// A direct message thread: sending, editing and deleting messages, room
// invitations sent as messages, and read state.

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import type { ConversationSummary } from '@voiceroom/shared/contracts/messages';
import { transaction } from '../../platform/db/pool.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { toMillis } from '../../platform/epoch-millis.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { cleanBadge } from '../account/user-records.ts';
import { contactAudience, pairBlocks } from '../social/contact-facts.repository.ts';
import { canCall, type ContactFacts } from '../social/contact.policy.ts';
import { withPairLock } from '../social/contact.service.ts';
import {
  type DirectMessage,
  type Metadata,
  between,
  inviteKind,
  inviteStatus,
  lockUserPair,
  mapMessage,
  mapPublicUser,
  now,
  orderedPair
} from '../social/social-records.ts';

export async function unreadCountsFor(q: Database, userId: string): Promise<Record<string, number>> {
  const rows = await q
    .selectFrom('direct_messages')
    .select(['sender_id', sql<number>`COUNT(*)::int`.as('count')])
    .where('recipient_id', '=', userId)
    .where('read_at', 'is', null)
    .where('deleted_at', 'is', null)
    .groupBy('sender_id')
    .execute();
  return Object.fromEntries(rows.map((row) => [row.sender_id, row.count]));
}

/** Whether the sender has a message to the recipient that is still there: the conversation is live. */
export async function hasLiveDirectMessage(q: Database, senderId: string, recipientId: string): Promise<boolean> {
  const row = await q
    .selectFrom('direct_messages')
    .select('id')
    .where('sender_id', '=', senderId)
    .where('recipient_id', '=', recipientId)
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Why the official account may not answer this person now, or null: only
 * into a conversation the person started and kept, and never to an account
 * that is gone. Takes the pair lock first, like every DM writer.
 */
export async function authorizeOfficialReply(tx: Database, recipientId: string): Promise<DomainError | null> {
  return withPairLock(tx, OFFICIAL_ACCOUNT_ID, recipientId, async (facts) => {
    if (!facts?.active) return new DomainError('account_deleted', 403, 'Account is unavailable');
    if (!(await hasLiveDirectMessage(tx, recipientId, OFFICIAL_ACCOUNT_ID)))
      return new DomainError('support_conversation_deleted', 409, 'The person deleted the conversation');
    return null;
  });
}

export function createDmThreadRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const getUnreadCounts = (userId: string) => unreadCountsFor(db, userId);

  async function listConversations(userId: string, limit = 200): Promise<ConversationSummary[]> {
    const low = sql<string>`least(sender_id, recipient_id)`;
    const high = sql<string>`greatest(sender_id, recipient_id)`;
    const latest = db
      .selectFrom('direct_messages')
      .leftJoin('friendships', (join) => join.on('user_a_id', '=', low).on('user_b_id', '=', high))
      .where((eb) => eb.or([eb('sender_id', '=', userId), eb('recipient_id', '=', userId)]))
      .where('deleted_at', 'is', null)
      .where((eb) => eb.not(eb.exists(pairBlocks(db, low, high))))
      .distinctOn([low, high])
      .select([
        'direct_messages.id as message_id',
        'direct_messages.created_at as message_at',
        'body',
        'sender_id',
        sql<boolean>`friendships.id is not null`.as('is_friend'),
        sql<string | null>`direct_messages.metadata->>'kind'`.as('kind'),
        sql<string>`case when sender_id = ${userId} then recipient_id else sender_id end`.as('peer_id'),
        sql<number>`(count(*) filter (where recipient_id = ${userId} and read_at is null)
          over (partition by ${low}, ${high}))::int`.as('unread_count')
      ])
      .orderBy(low)
      .orderBy(high)
      .orderBy('message_at', 'desc')
      .orderBy('message_id', 'desc');

    const rows = await db
      .selectFrom(latest.as('latest'))
      .innerJoin('users', 'users.id', 'latest.peer_id')
      .leftJoin('notification_dm_mutes as mutes', (join) =>
        join.onRef('mutes.peer_user_id', '=', 'latest.peer_id').on('mutes.user_id', '=', userId)
      )
      .select([
        'users.avatar_accent',
        'users.avatar_color_key',
        'users.avatar_key',
        'users.badge',
        'users.calls_from',
        'users.created_at',
        'users.display_name',
        'users.dnd',
        'users.id',
        'users.login',
        'users.presence_status'
      ])
      .select([
        'latest.body',
        'latest.kind',
        'latest.message_at',
        'latest.sender_id',
        'latest.unread_count',
        'latest.is_friend'
      ])
      .select((eb) => [
        eb
          .and([
            eb('users.deleted_at', 'is', null),
            eb('users.deletion_requested_at', 'is', null),
            eb.or([eb('users.blocked_at', 'is', null), eb('users.blocked_until', '<=', sql<Date>`clock_timestamp()`)])
          ])
          .as('active'),
        eb
          .exists(
            eb
              .selectFrom('contact_allow_list')
              .select('allowed_id')
              .whereRef('owner_id', '=', 'users.id')
              .where('allowed_id', '=', userId)
              .where('kind', '=', 'calls')
          )
          .as('selected_for_calls'),
        eb('mutes.id', 'is not', null).as('muted'),
        eb
          .exists(
            eb
              .selectFrom('message_attachments')
              .select('id')
              .whereRef('direct_message_id', '=', 'latest.message_id')
              .where('deleted_at', 'is', null)
          )
          .as('has_attachment')
      ])
      .orderBy('latest.message_at', 'desc')
      .orderBy('latest.message_id', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      peer: { ...mapPublicUser(row), badge: cleanBadge(row.badge) },
      lastMessage: {
        preview: row.body,
        kind: row.kind === 'voice-call' ? 'call' : !row.body && row.has_attachment ? 'attachment' : 'text',
        at: toMillis(row.message_at),
        fromMe: row.sender_id === userId
      },
      unreadCount: row.unread_count,
      isFriend: row.is_friend,
      canCall:
        canCall({
          friends: row.is_friend,
          blocked: false,
          active: Boolean(row.active),
          callsFrom: contactAudience(row.calls_from, 'friends'),
          selectedForCalls: Boolean(row.selected_for_calls),
          senderOfficial: false,
          recipientOfficial: row.id === OFFICIAL_ACCOUNT_ID
        }) === 'allowed',
      muted: Boolean(row.muted)
    }));
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

  // The unit of work runs on the deletion's connection, once the message is
  // gone, so whatever it removes with the message commits with it.
  async function softDeleteMessage(
    messageId: string,
    { unitOfWork = null }: { unitOfWork?: ((client: pg.PoolClient) => Promise<void>) | null } = {}
  ): Promise<boolean> {
    return transaction(pool, async (client) => {
      const tx = kyselyOn(client);
      const pair = await tx
        .selectFrom('direct_messages')
        .select(['sender_id', 'recipient_id'])
        .where('id', '=', messageId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!pair) return false;
      await lockUserPair(tx, pair.sender_id, pair.recipient_id);
      const result = await tx
        .updateTable('direct_messages')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', messageId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) return false;
      if (unitOfWork) await unitOfWork(client);
      return true;
    });
  }

  async function editMessage({
    messageId,
    senderId,
    recipientId,
    body,
    authorize
  }: {
    messageId: string;
    senderId: string;
    recipientId: string;
    body: string;
    authorize: (facts: ContactFacts | null) => void;
  }) {
    return transaction(pool, async (client) => {
      const tx = kyselyOn(client);
      return withPairLock(tx, senderId, recipientId, async (facts) => {
        authorize(facts);
        const row = await tx
          .updateTable('direct_messages')
          .set({ body, edited_at: now })
          .where('id', '=', messageId)
          .where('sender_id', '=', senderId)
          .where('recipient_id', '=', recipientId)
          .where('deleted_at', 'is', null)
          .where(sql<boolean>`metadata->>'kind' IS DISTINCT FROM 'voice-call'`)
          .returningAll()
          .executeTakeFirst();
        return mapMessage(row);
      });
    });
  }

  // A replay answers with the message the caller stored on the first send.
  async function sendMessage<Replayed extends object = DirectMessage>({
    senderId,
    recipientId,
    body,
    metadata = null,
    alreadyRead = false,
    replyToMessageId = null,
    beforeUnitOfWork = null,
    prepareMessage = null,
    unitOfWork = null
  }: {
    senderId: string;
    recipientId: string;
    body: string;
    metadata?: Metadata | null;
    alreadyRead?: boolean;
    replyToMessageId?: string | null;
    beforeUnitOfWork?:
      ((client: pg.PoolClient) => Promise<{ replay: true; message: Replayed } | null | undefined>) | null;
    /** Resolve an invitation's text/metadata after authorization under the same transaction lock. */
    prepareMessage?: ((client: pg.PoolClient) => Promise<{ body: string; metadata: Metadata }>) | null;
    unitOfWork?: ((client: pg.PoolClient, message: DirectMessage) => Promise<unknown>) | null;
  }) {
    const id = crypto.randomUUID();
    // A raw pg transaction: the hooks run their own SQL on the same client.
    return transaction(pool, async (client) => {
      const tx = kyselyOn(client);
      // The application hook takes this lock as part of authorization.
      if (!beforeUnitOfWork) await lockUserPair(tx, senderId, recipientId);
      if (beforeUnitOfWork) {
        const prepared = await beforeUnitOfWork(client);
        if (prepared?.replay) return { ...prepared.message, idempotencyReplay: true };
      }
      const preparedMessage = prepareMessage ? await prepareMessage(client) : { body, metadata };
      const row = await tx
        .insertInto('direct_messages')
        .values({
          id,
          sender_id: senderId,
          recipient_id: recipientId,
          body: preparedMessage.body,
          created_at: now,
          ...(alreadyRead && { read_at: now }),
          metadata: preparedMessage.metadata ? JSON.stringify(preparedMessage.metadata) : '{}',
          reply_to_message_id: replyToMessageId
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const message = mapMessage(row);
      if (unitOfWork) await unitOfWork(client, message);
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
    status: 'accepted' | 'declined';
  }) {
    return db.transaction().execute(async (tx) => {
      const invite = await tx
        .selectFrom('direct_messages')
        .select('sender_id')
        .where('id', '=', messageId)
        .where('recipient_id', '=', recipientId)
        .executeTakeFirst();
      if (!invite) return null;
      await lockUserPair(tx, invite.sender_id, recipientId);
      const row = await tx
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
    });
  }

  // Expires pending invitations for a room. Omitting senderId expires every
  // sender's invitations, which is what a deleted room needs.
  async function expirePendingInvites({ senderId = null, roomId }: { senderId?: string | null; roomId: string }) {
    return db.transaction().execute(async (tx) => {
      let query = tx
        .selectFrom('direct_messages')
        .select(['id', 'sender_id', 'recipient_id'])
        .where(inviteKind, '=', 'room-invite')
        .where(sql<string>`metadata->>'roomId'`, '=', roomId)
        .where(inviteStatus, '=', 'pending')
        .where('deleted_at', 'is', null);
      if (senderId) query = query.where('sender_id', '=', senderId);
      const pending = await query.execute();
      const pairs = new Map<string, [string, string]>();
      for (const invite of pending) {
        const pair = orderedPair(invite.sender_id, invite.recipient_id);
        pairs.set(pair.join(':'), pair);
      }
      for (const key of [...pairs.keys()].sort()) {
        const pair = pairs.get(key);
        if (pair) await lockUserPair(tx, ...pair);
      }
      if (!pending.length) return [];
      const rows = await tx
        .updateTable('direct_messages')
        .set({ metadata: sql`jsonb_set(metadata, '{status}', to_jsonb('expired'::text))` })
        .where(
          'id',
          'in',
          pending.map(({ id }) => id)
        )
        .where(inviteStatus, '=', 'pending')
        .where('deleted_at', 'is', null)
        .returningAll()
        .execute();
      return rows.map((row) => mapMessage(row));
    });
  }

  // Mark every message from peer -> user as read. Returns the number marked so
  // the caller can decide whether to broadcast a read receipt.
  async function markRead({ userId, peerId }: { userId: string; peerId: string }) {
    return db.transaction().execute(async (tx) => {
      await lockUserPair(tx, userId, peerId);
      const result = await tx
        .updateTable('direct_messages')
        .set({ read_at: now })
        .where('recipient_id', '=', userId)
        .where('sender_id', '=', peerId)
        .where('read_at', 'is', null)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return { count: Number(result.numUpdatedRows) };
    });
  }

  return {
    listConversations,
    listThread,
    getMessage,
    softDeleteMessage,
    editMessage,
    sendMessage,
    respondInvite,
    expirePendingInvites,
    markRead,
    getUnreadCounts
  };
}

export type DmThreadRepository = ReturnType<typeof createDmThreadRepository>;
