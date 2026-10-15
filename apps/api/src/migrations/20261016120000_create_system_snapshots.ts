// One row per minute of the server as the API saw it: the host's CPU, memory
// and disk, the database's size, the API process itself, its live
// connections and the requests it answered that minute. The admin panel reads
// it instead of a separate monitoring stack; rows older than 30 days are
// pruned by the same maintenance task that writes them.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('system_snapshots', {
    at: { type: 'timestamptz', primaryKey: true },
    cpu_pct: { type: 'real' },
    load1: { type: 'real', notNull: true, default: 0 },
    mem_used_bytes: { type: 'bigint', notNull: true, default: 0 },
    mem_total_bytes: { type: 'bigint', notNull: true, default: 0 },
    disk_used_bytes: { type: 'bigint' },
    disk_total_bytes: { type: 'bigint' },
    db_bytes: { type: 'bigint' },
    api_rss_bytes: { type: 'bigint', notNull: true, default: 0 },
    event_loop_p99_ms: { type: 'real', notNull: true, default: 0 },
    ws_connections: { type: 'integer', notNull: true, default: 0 },
    guest_connections: { type: 'integer', notNull: true, default: 0 },
    voice_peers: { type: 'integer', notNull: true, default: 0 },
    voice_rooms: { type: 'integer', notNull: true, default: 0 },
    http_requests: { type: 'integer', notNull: true, default: 0 },
    http_5xx: { type: 'integer', notNull: true, default: 0 },
    http_avg_ms: { type: 'real' }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('system_snapshots');
}
