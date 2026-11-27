import type pg from 'pg';
import { sql } from 'kysely';
import { kyselyOn } from '../../platform/db/kysely.ts';
import type { AttachmentRepository } from '../media/attachment.repository.ts';
import { between, now } from '../social/social-records.ts';

const BATCH_SIZE = 500;

export async function purgeDirectConversation(
  client: pg.PoolClient,
  userId: string,
  peerId: string,
  attachments: Pick<AttachmentRepository, 'listForMessages'>
): Promise<boolean> {
  const tx = kyselyOn(client);
  const messages = tx.selectFrom('direct_messages').select('id').where(between(userId, peerId));

  // A pending room invitation ends as it would on any other cancellation: its
  // terminal revision is queued for both participants, so a device that showed
  // the incoming cue gets its stop signal and a delayed first cue is superseded.
  // The ring rows outlive the messages until their own 24-hour retention: they
  // hold the invite rate window and the request identity a retry replays.
  const invites = tx
    .selectFrom('room_rings')
    .select('id')
    .where('purpose', '=', 'room-invite')
    .where('invite_message_id', 'in', messages);
  const cancelled = await tx
    .updateTable('room_rings')
    .set({
      state: sql<string>`CASE WHEN expires_at <= clock_timestamp() THEN 'expired' ELSE 'cancelled' END`,
      revision: 2,
      ended_at: sql<Date>`clock_timestamp()`,
      reason: sql<string | null>`CASE WHEN expires_at <= clock_timestamp() THEN NULL ELSE 'unavailable' END`
    })
    .where('id', 'in', invites)
    .where('state', '=', 'pending')
    .returning(['id', 'caller_user_id', 'recipient_user_id'])
    .execute();
  if (cancelled.length) {
    await tx
      .deleteFrom('ring_delivery_outbox')
      .where('purpose', '=', 'room-invite')
      .where('kind', '=', 'incoming')
      .where(
        'ring_id',
        'in',
        cancelled.map(({ id }) => id)
      )
      .execute();
    await tx
      .insertInto('ring_delivery_outbox')
      .values(
        cancelled.flatMap((ring) =>
          [ring.recipient_user_id, ring.caller_user_id].map((recipient) => ({
            ring_id: ring.id,
            revision: 2,
            recipient_user_id: recipient,
            kind: 'terminal',
            deadline: sql<Date>`clock_timestamp() + interval '5 minutes'`
          }))
        )
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }

  // Closed voice-call rows have a separate retention window for private room
  // cleanup. Their message-linked missed/incoming pushes are obsolete now.
  await tx
    .deleteFrom('ring_delivery_outbox')
    .where('kind', 'in', ['call-incoming', 'call-missed'])
    .where(
      'ring_id',
      'in',
      tx
        .selectFrom('room_rings')
        .select('id')
        .where('purpose', '=', 'voice-call')
        .where('invite_message_id', 'in', messages)
    )
    .execute();

  let lastId: string | undefined;
  for (;;) {
    const page = lastId === undefined ? messages : messages.where('id', '>', lastId);
    const ids = (await page.orderBy('id').limit(BATCH_SIZE).execute()).map(({ id }) => id);
    if (!ids.length) break;
    lastId = ids.at(-1);

    const bound = await attachments.listForMessages('dm', ids, { client });
    const attachmentIds = [...bound.values()].flatMap((items) => items.map(({ id }) => id));
    if (attachmentIds.length) {
      await tx
        .updateTable('message_attachments')
        .set({
          direct_message_id: null,
          attachment_order: null,
          bound_at: null,
          state: 'deleted',
          deleted_at: (eb) => eb.fn.coalesce('deleted_at', now),
          updated_at: now
        })
        .where('id', 'in', attachmentIds)
        .execute();
    }
  }

  await tx
    .deleteFrom('direct_message_read_cursors')
    .where((eb) =>
      eb.or([
        eb.and([eb('user_id', '=', userId), eb('peer_user_id', '=', peerId)]),
        eb.and([eb('user_id', '=', peerId), eb('peer_user_id', '=', userId)])
      ])
    )
    .execute();
  await tx
    .deleteFrom('message_send_idempotency')
    .where('conversation_type', '=', 'dm')
    .where('message_id', 'in', messages)
    .execute();
  await tx
    .deleteFrom('notification_outbox')
    .where('status', 'in', ['pending', 'processing'])
    .where(sql<string>`payload->>'type'`, '=', 'dm.message')
    .where(sql<string>`payload->>'dedupeKey'`, 'in', messages.clearSelect().select(sql<string>`'dm:' || id`.as('key')))
    .execute();
  await tx
    .deleteFrom('message_delivery_outbox')
    .where('conversation_type', '=', 'dm')
    .where('message_id', 'in', messages)
    .execute();
  const result = await tx.deleteFrom('direct_messages').where(between(userId, peerId)).executeTakeFirst();
  return result.numDeletedRows > 0n;
}

export async function hasActiveVoiceCall(client: pg.PoolClient, userId: string, peerId: string): Promise<boolean> {
  const call = await kyselyOn(client)
    .selectFrom('room_rings')
    .select('id')
    .where('purpose', '=', 'voice-call')
    .where('call_phase', '!=', 'closed')
    .where((eb) =>
      eb.or([
        eb.and([eb('caller_user_id', '=', userId), eb('recipient_user_id', '=', peerId)]),
        eb.and([eb('caller_user_id', '=', peerId), eb('recipient_user_id', '=', userId)])
      ])
    )
    .executeTakeFirst();
  return Boolean(call);
}
