// Why a minute of a stay's voice went as it did. Its counts are summed over every
// speaker, which waters down one speaker's trouble to next to nothing, so a
// minute also keeps the worst 15 seconds of any one speaker on each side, and how
// many of its polls gave each cause. Counts only, gone with the minute.

import type { MigrationBuilder } from 'node-pg-migrate';

const count = { type: 'integer', notNull: true, default: 0 } as const;

const COLUMNS = {
  polls_heard_badly: count,
  polls_hears_badly: count,
  polls_delay: count,
  heard_worst_concealed_pct: { type: 'real' },
  heard_worst_gaps: count,
  heard_by_worst_concealed_pct: { type: 'real' },
  heard_by_worst_gaps: count
} as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_session_samples', COLUMNS);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('voice_session_samples', Object.keys(COLUMNS));
}
