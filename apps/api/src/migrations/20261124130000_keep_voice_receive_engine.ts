import type { MigrationBuilder } from 'node-pg-migrate';

const SAMPLES = 'voice_session_samples';
const RECEIVE = {
  receive_engine: { type: 'varchar(7)', check: "receive_engine IN ('browser', 'native')" },
  native_heard_concealed: { type: 'integer' },
  native_heard_gaps: { type: 'integer' }
} as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns(SAMPLES, RECEIVE);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns(SAMPLES, Object.keys(RECEIVE));
}
