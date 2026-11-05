// How long joining took, stage by stage, as the joining client measured it. With
// the round trip a stay's minutes already keep, this says how a join goes for
// someone far from the server without keeping where anyone is.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumn('voice_sessions', { join_timing: { type: 'jsonb' } });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumn('voice_sessions', 'join_timing');
}
