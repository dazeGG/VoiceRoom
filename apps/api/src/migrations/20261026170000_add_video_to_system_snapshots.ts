// The server's video beside its load, minute by minute: screen shares and
// cameras running at once at most, the most video the budget counted as sent
// against the budget, and the stream starts it lowered or refused. Counts
// only, no people or rooms. Nullable: minutes before this one, and an API
// without the room runtime, have none.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('system_snapshots', {
    video_screens_max: { type: 'integer' },
    video_cameras_max: { type: 'integer' },
    video_mbps_max: { type: 'real' },
    video_budget_mbps: { type: 'real' },
    media_lowered: { type: 'integer' },
    media_refused: { type: 'integer' }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('system_snapshots', [
    'video_screens_max',
    'video_cameras_max',
    'video_mbps_max',
    'video_budget_mbps',
    'media_lowered',
    'media_refused'
  ]);
}
