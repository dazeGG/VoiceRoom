// A stay's voice minute by minute, for the admin panel's call bars: the
// server's own counts from the stats polls of a peer in voice
// (realtime room.voice.report), written with the stay when it ends. Counts
// only: what the peer heard of the others and they of it, the polls of each
// level, the round trip, the uplink and the transport. The level is read from
// the polls when the panel asks. The rows go with their stay, and are deleted
// with the room's history after VOICE_HISTORY_KEEP_DAYS.

import type { MigrationBuilder } from 'node-pg-migrate';

const count = { type: 'integer', notNull: true, default: 0 } as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('voice_session_samples', {
    stay_id: { type: 'uuid', notNull: true, references: 'voice_sessions(id)', onDelete: 'CASCADE' },
    at: { type: 'timestamptz', notNull: true },
    polls_good: count,
    polls_unstable: count,
    polls_bad: count,
    heard_packets: count,
    heard_lost: count,
    heard_concealed: count,
    heard_gaps: count,
    heard_by_packets: count,
    heard_by_lost: count,
    heard_by_concealed: count,
    heard_by_gaps: count,
    rtt_ms_sum: { type: 'real', notNull: true, default: 0 },
    rtt_polls: count,
    jitter_buffer_ms_sum: { type: 'real', notNull: true, default: 0 },
    jitter_buffer_polls: count,
    uplink_packets: count,
    uplink_lost: count,
    transport: { type: 'varchar(8)' }
  });
  pgm.addConstraint('voice_session_samples', 'voice_session_samples_pkey', { primaryKey: ['stay_id', 'at'] });
  pgm.addConstraint('voice_session_samples', 'voice_session_samples_transport_check', {
    check: "transport IN ('udp', 'tcp', 'relay')"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('voice_session_samples');
}
