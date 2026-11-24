import { sql } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import { ringPairRefusal } from '../social/pair-eligibility.repository.ts';

export async function callGateAllows(db: Database, roomId: string, userId: string): Promise<boolean> {
  const call = await db
    .selectFrom('room_rings')
    .select(['caller_user_id', 'recipient_user_id'])
    .where('room_id', '=', roomId)
    .where('purpose', '=', 'voice-call')
    .where('started_at', 'is not', null)
    .where('call_phase', '!=', 'closed')
    .where((eb) => eb.or([eb('alone_deadline', 'is', null), eb('alone_deadline', '>', sql<Date>`clock_timestamp()`)]))
    .where((eb) => eb.or([eb('caller_user_id', '=', userId), eb('recipient_user_id', '=', userId)]))
    .executeTakeFirst();
  return Boolean(call && !(await ringPairRefusal(db, call.caller_user_id, call.recipient_user_id)));
}
