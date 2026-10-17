// A stay in voice keeps its room only for a while (VOICE_HISTORY_KEEP_DAYS);
// past it the maintenance sweep clears room_id, so the row still counts
// towards the usage numbers but no longer says who talked with whom.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.alterColumn('voice_sessions', 'room_id', { notNull: false });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  // The rooms that were forgotten stay forgotten: an empty id keeps the usage rows.
  pgm.sql("UPDATE voice_sessions SET room_id = '' WHERE room_id IS NULL");
  pgm.alterColumn('voice_sessions', 'room_id', { notNull: true });
}
