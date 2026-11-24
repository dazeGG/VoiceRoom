import type { MigrationBuilder } from 'node-pg-migrate';

const EVENTS = 'voice_call_events';
const KINDS = "'screen_on', 'screen_off', 'camera_on', 'camera_off', 'cpu_critical', 'relieved_ns', 'relief'";
const KIND_CHECK = 'voice_call_events_kind_check';
const FALLBACK_CHECK = 'voice_call_events_native_fallback_check';
const REASON = 'native_fallback_reason';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumn(EVENTS, { [REASON]: { type: 'varchar(40)' } });
  pgm.dropConstraint(EVENTS, KIND_CHECK);
  pgm.addConstraint(EVENTS, KIND_CHECK, { check: `kind IN (${KINDS}, 'native_fallback')` });
  pgm.addConstraint(EVENTS, FALLBACK_CHECK, {
    check: `(kind = 'native_fallback') = (${REASON} IS NOT NULL) AND ${REASON} ~ '^[a-z_]+$'`
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql('LOCK TABLE voice_call_events IN ACCESS EXCLUSIVE MODE');
  pgm.sql("DELETE FROM voice_call_events WHERE kind = 'native_fallback'");
  pgm.dropConstraint(EVENTS, FALLBACK_CHECK);
  pgm.dropConstraint(EVENTS, KIND_CHECK);
  pgm.addConstraint(EVENTS, KIND_CHECK, { check: `kind IN (${KINDS})` });
  pgm.dropColumn(EVENTS, REASON);
}
