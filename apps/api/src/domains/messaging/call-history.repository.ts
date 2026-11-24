import { sql } from 'kysely';
import type { CallMissedCount, CallMissedSeenBody, DirectMessageCall } from '@voiceroom/shared/contracts/rings';
import type { Database } from '../../platform/db/kysely.ts';
import { inviteKind, mapMessage } from '../social/social-records.ts';

const missedOrder = sql<string>`(metadata#>>'{missedWatermark,order}')::bigint`;
const missedAt = sql<string>`metadata#>>'{missedWatermark,missedAt}'`;

export async function nextMissedRevision(db: Database): Promise<number> {
  const row = await db
    .selectNoFrom(sql<string>`nextval('call_missed_revision_seq')::text`.as('revision'))
    .executeTakeFirstOrThrow();
  return Number(row.revision);
}

export async function lockCallMessage(db: Database, messageId: string) {
  const row = await db
    .selectFrom('direct_messages')
    .selectAll()
    .where('id', '=', messageId)
    .where('deleted_at', 'is', null)
    .where(inviteKind, '=', 'voice-call')
    .forUpdate()
    .executeTakeFirst();
  return mapMessage(row);
}

export async function updateCallMessage(
  db: Database,
  messageId: string,
  call: DirectMessageCall,
  missedWatermark?: { order: number; missedAt: number }
) {
  const patch = JSON.stringify({ call, ...(missedWatermark ? { missedWatermark } : {}) });
  const row = await db
    .updateTable('direct_messages')
    .set({ metadata: sql`metadata || ${patch}::jsonb` })
    .where('id', '=', messageId)
    .where('deleted_at', 'is', null)
    .where(inviteKind, '=', 'voice-call')
    .where(sql<number>`(metadata#>>'{call,revision}')::integer`, '<', call.revision)
    .returningAll()
    .executeTakeFirst();
  return mapMessage(row);
}

function unreadMisses(db: Database, userId: string, peerId?: string) {
  let query = db
    .selectFrom('direct_messages')
    .where('recipient_id', '=', userId)
    .where('deleted_at', 'is', null)
    .where(inviteKind, '=', 'voice-call')
    .where(sql<boolean>`jsonb_typeof(metadata#>'{call,missedAt}') = 'number'`)
    .where(sql<boolean>`metadata#>>'{call,missedSeenRevision}' IS NULL`)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('friendships')
          .select('id')
          .where('user_a_id', '=', sql<string>`least(sender_id, recipient_id)`)
          .where('user_b_id', '=', sql<string>`greatest(sender_id, recipient_id)`)
      )
    );
  if (peerId !== undefined) query = query.where('sender_id', '=', peerId);
  return query;
}

export async function listMissedCalls(db: Database, userId: string, peerId?: string): Promise<CallMissedCount[]> {
  const rows = await unreadMisses(db, userId, peerId)
    .distinctOn('sender_id')
    .select([
      'id',
      'sender_id',
      missedAt.as('missed_at'),
      sql<number>`count(*) OVER (PARTITION BY sender_id)::int`.as('count')
    ])
    .orderBy('sender_id')
    .orderBy(missedOrder, 'desc')
    .execute();
  return rows.map((row) => ({
    peerUserId: row.sender_id,
    count: row.count,
    watermark: { missedAt: Number(row.missed_at), messageId: row.id }
  }));
}

export async function markCallMissesSeen(
  db: Database,
  userId: string,
  peerId: string,
  watermark: CallMissedSeenBody['watermark']
) {
  // The stored anchor survives acknowledgement, a later connection and soft deletion.
  // Its sequence orders committed misses under the pair lock, including equal wall-clock times.
  const anchor = await db
    .selectFrom('direct_messages')
    .select(missedOrder.as('order'))
    .where('id', '=', watermark.messageId)
    .where('recipient_id', '=', userId)
    .where('sender_id', '=', peerId)
    .where(inviteKind, '=', 'voice-call')
    .where(missedAt, '=', String(watermark.missedAt))
    .executeTakeFirst();
  if (!anchor) return;
  await db
    .updateTable('direct_messages')
    .set({ metadata: sql`jsonb_set(metadata, '{call,missedSeenRevision}', metadata#>'{call,missedRevision}')` })
    .where('id', 'in', unreadMisses(db, userId, peerId).select('id').where(missedOrder, '<=', anchor.order))
    .execute();
}

export async function findCallMessagePeer(db: Database, userId: string, callId: string) {
  const row = await db
    .selectFrom('direct_messages')
    .select(['sender_id', 'recipient_id'])
    .where((eb) => eb.or([eb('sender_id', '=', userId), eb('recipient_id', '=', userId)]))
    .where(inviteKind, '=', 'voice-call')
    .where(sql<string>`metadata#>>'{call,callId}'`, '=', callId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? (row.sender_id === userId ? row.recipient_id : row.sender_id) : null;
}
