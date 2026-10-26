// The media server's own minute beside the host's: the bytes and packets
// LiveKit took in and sent out, the packets lost each way and sent again, and
// its process's CPU share and memory. All nullable: a minute where LiveKit's
// metrics could not be read, and every minute before this one, has none.

import type { MigrationBuilder } from 'node-pg-migrate';

const COLUMNS = [
  'sfu_bytes_in',
  'sfu_bytes_out',
  'sfu_packets_in',
  'sfu_lost_in',
  'sfu_packets_out',
  'sfu_lost_out',
  'sfu_retransmit_out',
  'sfu_rss_bytes'
] as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('system_snapshots', {
    ...Object.fromEntries(COLUMNS.map((column) => [column, { type: 'bigint' }])),
    sfu_cpu_pct: { type: 'real' }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropColumns('system_snapshots', [...COLUMNS, 'sfu_cpu_pct']);
}
