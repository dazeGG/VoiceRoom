import type { MigrationBuilder } from 'node-pg-migrate';

const SAMPLES = {
  window_visible_polls: { type: 'integer' },
  window_hidden_polls: { type: 'integer' },
  window_covered_polls: { type: 'integer' },
  playout_synthesized_pct: { type: 'double precision' },
  playout_events: { type: 'integer' }
} as const;
const RELIEF = { relief_kind: { type: 'varchar(8)' }, relief_outcome: { type: 'varchar(8)' } } as const;
const KINDS = "'screen_on', 'screen_off', 'camera_on', 'camera_off', 'cpu_critical', 'relieved_ns'";
const KIND_CHECK = 'voice_call_events_kind_check';
const RELIEF_CHECK = 'voice_call_events_relief_check';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumn('voice_sessions', { desktop_version: { type: 'varchar(40)' } });
  pgm.addColumns('voice_session_samples', SAMPLES);
  pgm.addColumns('voice_call_events', RELIEF);
  pgm.dropConstraint('voice_call_events', KIND_CHECK);
  pgm.addConstraint('voice_call_events', KIND_CHECK, { check: `kind IN (${KINDS}, 'relief')` });
  pgm.addConstraint('voice_call_events', RELIEF_CHECK, {
    check: `CASE WHEN kind = 'relief' THEN
      relief_kind IS NOT NULL AND relief_kind IN ('noise', 'video', 'screen') AND
      relief_outcome IS NOT NULL AND relief_outcome IN ('applied', 'failed')
      ELSE relief_kind IS NULL AND relief_outcome IS NULL END`
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql('LOCK TABLE voice_call_events IN ACCESS EXCLUSIVE MODE');
  pgm.sql("DELETE FROM voice_call_events WHERE kind = 'relief'");
  pgm.dropConstraint('voice_call_events', RELIEF_CHECK);
  pgm.dropConstraint('voice_call_events', KIND_CHECK);
  pgm.addConstraint('voice_call_events', KIND_CHECK, { check: `kind IN (${KINDS})` });
  pgm.dropColumns('voice_call_events', Object.keys(RELIEF));
  pgm.dropColumns('voice_session_samples', Object.keys(SAMPLES));
  pgm.dropColumn('voice_sessions', 'desktop_version');
}
