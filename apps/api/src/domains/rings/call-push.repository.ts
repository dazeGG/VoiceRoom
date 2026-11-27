import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { callMetadataOf } from '@voiceroom/shared/contracts/messages';
import { kyselyOn, withTransaction, type Database } from '../../platform/db/kysely.ts';
import { getCallRefusal } from '../social/contact.service.ts';

type Kind = 'call-incoming' | 'call-dismissal' | 'call-missed';
export const CALL_DISMISSAL_TTL_MS = 5 * 60_000;
export const CALL_MISSED_TTL_MS = 15 * 60_000;

export function enqueueCallPush(
  db: Database,
  kind: Kind,
  call: { id: string; revision: number; attempt: number },
  recipientId: string,
  now: number,
  deadline: number
) {
  return db
    .insertInto('ring_delivery_outbox')
    .values({
      ring_id: call.id,
      purpose: 'voice-call',
      kind,
      revision: call.revision,
      attempt: call.attempt,
      recipient_user_id: recipientId,
      available_at: new Date(now),
      deadline: new Date(deadline)
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export function createCallPushRepository(pool: pg.Pool, clock: () => number) {
  const db = kyselyOn(pool);
  const table = 'ring_delivery_outbox';

  function claim() {
    return withTransaction(db, async (trx) => {
      const now = new Date(clock());
      const next = await trx
        .selectFrom(table)
        .selectAll()
        .where('purpose', '=', 'voice-call')
        .where('deadline', '>', now)
        .where('available_at', '<=', now)
        .where((eb) => eb.or([eb('claimed_until', 'is', null), eb('claimed_until', '<=', now)]))
        .orderBy('available_at')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!next) return undefined;
      return trx
        .updateTable(table)
        .set({
          claim_token: randomUUID(),
          claimed_until: new Date(now.getTime() + 30_000),
          attempts: next.attempts + 1
        })
        .where('ring_id', '=', next.ring_id)
        .where('revision', '=', next.revision)
        .where('recipient_user_id', '=', next.recipient_user_id)
        .where('kind', '=', next.kind)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  type Job = NonNullable<Awaited<ReturnType<typeof claim>>>;

  async function current(job: Job) {
    const now = new Date(clock());
    if (job.attempt === null || !job.claim_token || job.deadline <= now) return null;
    const row = await db
      .selectFrom(table)
      .innerJoin('room_rings as r', 'r.id', 'ring_delivery_outbox.ring_id')
      .leftJoin('direct_messages as m', 'm.id', 'r.invite_message_id')
      .select([
        'r.caller_user_id',
        'r.recipient_user_id as original_recipient',
        'r.call_phase',
        'r.attempt_inviter_user_id',
        'r.attempt as current_attempt',
        'r.call_revision',
        'r.ringing_expires_at',
        'r.first_connected_at',
        'm.metadata',
        'm.deleted_at'
      ])
      .where('ring_delivery_outbox.claim_token', '=', job.claim_token)
      .where('ring_delivery_outbox.purpose', '=', 'voice-call')
      .where('ring_delivery_outbox.claimed_until', '>', now)
      .executeTakeFirst();
    if (
      !row ||
      row.current_attempt === null ||
      row.current_attempt < job.attempt ||
      (job.recipient_user_id !== row.caller_user_id && job.recipient_user_id !== row.original_recipient)
    )
      return null;
    const peerId = job.recipient_user_id === row.caller_user_id ? row.original_recipient : row.caller_user_id;
    if (job.kind === 'call-dismissal') {
      // A revocation must still retract an alert already shown on a device.
      if (row.call_revision === null || row.call_revision < job.revision) return null;
      return { peerId, attempt: job.attempt, dismissMissed: row.first_connected_at !== null };
    }
    if (row.deleted_at || (await getCallRefusal(db, peerId, job.recipient_user_id))) return null;
    if (job.kind === 'call-incoming') {
      if (
        row.current_attempt !== job.attempt ||
        row.call_phase !== 'ringing' ||
        row.attempt_inviter_user_id !== peerId ||
        !row.ringing_expires_at ||
        row.ringing_expires_at <= new Date(clock())
      )
        return null;
    } else if (job.kind === 'call-missed') {
      const call = callMetadataOf(row.metadata);
      if (
        job.recipient_user_id !== row.original_recipient ||
        !call ||
        call.missedRevision !== job.revision ||
        call.missedAt === null ||
        call.missedSeenRevision !== null
      )
        return null;
    } else return null;
    return { peerId, attempt: job.attempt, dismissMissed: false };
  }

  async function finish(job: Job, retry = false) {
    if (job.claim_token === null) return;
    if (retry) {
      const backoff = Math.min(30, 2 ** Math.min(job.attempts, 5)) * 1_000;
      await db
        .updateTable(table)
        .set({ claim_token: null, claimed_until: null, available_at: new Date(clock() + backoff) })
        .where('claim_token', '=', job.claim_token)
        .execute();
    } else {
      await db.deleteFrom(table).where('claim_token', '=', job.claim_token).execute();
    }
  }

  async function prune() {
    await db.deleteFrom(table).where('purpose', '=', 'voice-call').where('deadline', '<=', new Date(clock())).execute();
  }

  return { claim, current, finish, prune };
}
