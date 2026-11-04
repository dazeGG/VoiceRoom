// What the admin panel's call page shows beyond the voice itself. A stay's
// minutes also say how its computer did (from the same stats polls: VoiceRoom's
// share and the whole system's, the highest pressure, whether the lighter noise
// suppression was on), and a stay keeps what its seat did: a screen or a camera
// going on or off, the computer overloading, the relief. Counts and times only.
// The events go with their stay, and are deleted with the room's history after
// VOICE_HISTORY_KEEP_DAYS, as the minutes are.

import type { MigrationBuilder } from 'node-pg-migrate';

const COLUMNS = {
  cpu_app_pct_sum: { type: 'real', notNull: true, default: 0 },
  cpu_system_pct_sum: { type: 'real', notNull: true, default: 0 },
  cpu_polls: { type: 'integer', notNull: true, default: 0 },
  cpu_pressure_max: { type: 'varchar(8)' },
  cpu_relieved: { type: 'boolean', notNull: true, default: false }
} as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_session_samples', COLUMNS);
  pgm.addConstraint('voice_session_samples', 'voice_session_samples_cpu_pressure_check', {
    check: "cpu_pressure_max IN ('nominal', 'fair', 'serious', 'critical')"
  });
  pgm.createTable('voice_call_events', {
    stay_id: { type: 'uuid', notNull: true, references: 'voice_sessions(id)', onDelete: 'CASCADE' },
    at: { type: 'timestamptz', notNull: true },
    kind: { type: 'varchar(16)', notNull: true }
  });
  pgm.addConstraint('voice_call_events', 'voice_call_events_kind_check', {
    check: "kind IN ('screen_on', 'screen_off', 'camera_on', 'camera_off', 'cpu_critical', 'relieved_ns')"
  });
  pgm.createIndex('voice_call_events', ['stay_id', 'at'], { name: 'voice_call_events_stay_idx' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('voice_call_events');
  pgm.dropConstraint('voice_session_samples', 'voice_session_samples_cpu_pressure_check');
  pgm.dropColumns('voice_session_samples', Object.keys(COLUMNS));
}
