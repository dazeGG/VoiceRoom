import type { Pool } from 'pg';
import { createCallRoom } from '../../src/domains/rooms/room.repository.ts';
import { createRowId } from '../../src/platform/db/ids.ts';
import { kyselyOn } from '../../src/platform/db/kysely.ts';

export function seedVoiceCall(pool: Pool, callerId: string, recipientId: string, at = Date.now()) {
  return kyselyOn(pool)
    .transaction()
    .execute(async (trx) => {
      const room = await createCallRoom(trx, at);
      const callId = createRowId();
      await trx
        .insertInto('room_rings')
        .values({
          id: callId,
          caller_user_id: callerId,
          recipient_user_id: recipientId,
          room_id: room.id,
          client_request_id: createRowId(),
          invite_message_id: createRowId(),
          purpose: 'voice-call',
          state: null,
          revision: null,
          created_at: new Date(at),
          call_phase: 'ringing',
          attempt: 1,
          attempt_inviter_user_id: callerId,
          attempt_result: 'pending',
          started_at: new Date(at),
          ringing_expires_at: new Date(at + 45_000),
          alone_deadline: new Date(at + 300_000),
          mutual_ms: 0,
          call_revision: 1
        })
        .execute();
      return { callId, room };
    });
}
