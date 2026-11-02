// What a stay's minutes say of its microphone: how much sound should have
// reached the encoder, how much did and how far the capture's own clock ran,
// and how often the client rebuilt the capture or the media connection for it.
// Counts only, summed from the stats polls like the rest of the row. A microphone
// that stops feeding its encoder loses no packet, so the uplink counts miss it.

import type { MigrationBuilder } from 'node-pg-migrate';

const count = { type: 'integer', notNull: true, default: 0 } as const;

const COLUMNS = {
  mic_expected_ms: count,
  mic_delivered_ms: count,
  mic_context_ms: count,
  mic_reopens: count,
  mic_replacements: count
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('voice_session_samples', COLUMNS);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('voice_session_samples', Object.keys(COLUMNS));
}
