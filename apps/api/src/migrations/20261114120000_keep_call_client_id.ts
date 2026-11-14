// A random browser/application installation id accompanies account and guest
// stays alike. Older guest history already has this id; account history does not.
// It expires with the room/origin data after VOICE_HISTORY_KEEP_DAYS.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_sessions', { client_id: { type: 'uuid' } });
  pgm.sql('UPDATE voice_sessions SET client_id = guest_id WHERE guest_id IS NOT NULL AND room_id IS NOT NULL');
  pgm.createIndex('voice_sessions', ['client_id', 'joined_at'], {
    name: 'voice_sessions_client_id_idx',
    where: 'client_id IS NOT NULL'
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropIndex('voice_sessions', ['client_id', 'joined_at'], { name: 'voice_sessions_client_id_idx' });
  pgm.dropColumns('voice_sessions', ['client_id']);
}
