import { sql } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import { getCallRefusal } from '../social/contact.service.ts';
import type { GateClaims } from './gate-credential-signer.ts';

export async function callGateAllows(
  db: Database,
  { room, pId, pEpoch, cid }: Pick<GateClaims, 'room' | 'pId' | 'pEpoch' | 'cid'>
): Promise<boolean> {
  const call = await db
    .selectFrom('room_rings')
    .select(['caller_user_id', 'recipient_user_id', 'attempt_inviter_user_id'])
    .where('room_id', '=', room)
    .where('purpose', '=', 'voice-call')
    .where('started_at', 'is not', null)
    .where('call_phase', '!=', 'closed')
    .where((eb) => eb.or([eb('alone_deadline', 'is', null), eb('alone_deadline', '>', sql<Date>`clock_timestamp()`)]))
    .where((eb) => eb.or([eb('caller_user_id', '=', pId), eb('recipient_user_id', '=', pId)]))
    // A started voice call always records its attempt's inviter (room_rings check).
    .where('attempt_inviter_user_id', 'is not', null)
    .$narrowType<{ attempt_inviter_user_id: string }>()
    .executeTakeFirst();
  // The current attempt's inviter is the one calling; the other participant decides.
  if (
    !call ||
    (await getCallRefusal(
      db,
      call.attempt_inviter_user_id,
      call.attempt_inviter_user_id === call.caller_user_id ? call.recipient_user_id : call.caller_user_id
    ))
  )
    return false;
  // The standalone gate shares the durable revocation with the API. Recheck it
  // after the call and friendship reads, since a seat can leave during either.
  return Boolean(
    await db
      .selectFrom('livekit_gate_credentials as c')
      .innerJoin('livekit_gate_principal_epochs as e', (join) =>
        join
          .onRef('e.room_id', '=', 'c.room_id')
          .onRef('e.principal_type', '=', 'c.principal_type')
          .onRef('e.principal_id', '=', 'c.principal_id')
      )
      .innerJoin('room_rings as r', 'r.room_id', 'c.room_id')
      .select('c.id')
      .where('r.purpose', '=', 'voice-call')
      .where('r.call_phase', '!=', 'closed')
      .where((eb) =>
        eb.or([eb('r.alone_deadline', 'is', null), eb('r.alone_deadline', '>', sql<Date>`clock_timestamp()`)])
      )
      .where('c.id', '=', cid)
      .where('c.room_id', '=', room)
      .where('c.principal_id', '=', pId)
      .where('c.principal_type', '=', 'account')
      .where('c.principal_epoch', '=', pEpoch)
      .where('e.epoch', '=', pEpoch)
      .where('c.revoked_at', 'is', null)
      .executeTakeFirst()
  );
}
