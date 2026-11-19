// The kind of room a stay was in. Widget rooms are temporary and go once
// empty, so their history can only tell them from the app's own rooms by what
// each stay kept. Stays recorded before this have none.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    ALTER TABLE voice_sessions
      ADD COLUMN room_kind text,
      ADD CONSTRAINT voice_sessions_room_kind_check CHECK (room_kind IN ('main', 'widget'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql(`
    ALTER TABLE voice_sessions
      DROP CONSTRAINT voice_sessions_room_kind_check,
      DROP COLUMN room_kind;
  `);
}
