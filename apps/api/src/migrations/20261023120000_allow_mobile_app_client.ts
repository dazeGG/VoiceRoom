// A stay in voice may come from the VoiceRoom Android app, a client kind of its
// own. A rollback counts those stays as a phone again, so the older check
// holds over every row.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('voice_sessions', 'voice_sessions_client_check');
  pgm.addConstraint('voice_sessions', 'voice_sessions_client_check', {
    check: "client IS NULL OR client IN ('desktop_app', 'mobile_app', 'mobile', 'browser')"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropConstraint('voice_sessions', 'voice_sessions_client_check');
  pgm.sql("UPDATE voice_sessions SET client = 'mobile' WHERE client = 'mobile_app'");
  pgm.addConstraint('voice_sessions', 'voice_sessions_client_check', {
    check: "client IS NULL OR client IN ('desktop_app', 'mobile', 'browser')"
  });
}
