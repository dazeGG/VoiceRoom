// The admin panel reads a call against what the network did: a stay in voice
// keeps each change of its client's network level (good / unstable / bad,
// realtime room.peer.update `network`), and an answer to "how was the call?"
// keeps the guest browser id that finds the stay it is about. Both are cleared
// with the rest of whose and where from after VOICE_HISTORY_KEEP_DAYS.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_sessions', { network: { type: 'jsonb' } });
  pgm.addColumns('call_feedback', { guest_id: { type: 'uuid' } });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('call_feedback', ['guest_id']);
  pgm.dropColumns('voice_sessions', ['network']);
}
