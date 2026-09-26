// A direct message thread: sending, editing and deleting messages, room
// invitations sent as messages, and read state.

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { transaction } from '../../platform/db/pool.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import {
  type DirectMessage,
  type Metadata,
  between,
  inviteKind,
  inviteStatus,
  mapMessage,
  now
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

export function createDmThreadRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);
  const getUnreadCounts = (userId: string) => unreadCountsFor(db, userId);

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

  return {
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
