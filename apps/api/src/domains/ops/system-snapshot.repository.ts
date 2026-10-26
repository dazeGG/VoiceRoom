// The server's minute-by-minute record for the admin panel. The only writer of
// system_snapshots.

import type pg from 'pg';
import { sql } from 'kysely';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';

export type SystemSnapshot = {
  /** The start of the minute. */
  at: Date;
  cpuPct: number | null;
  load1: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  apiRssBytes: number;
  eventLoopP99Ms: number;
  wsConnections: number;
  guestConnections: number;
  voicePeers: number;
  voiceRooms: number;
  httpRequests: number;
  http5xx: number;
  httpAvgMs: number | null;
  /** The media server's minute (livekit-metrics.ts); null when it could not be read. */
  sfuBytesIn: number | null;
  sfuBytesOut: number | null;
  sfuPacketsIn: number | null;
  sfuLostIn: number | null;
  sfuPacketsOut: number | null;
  sfuLostOut: number | null;
  sfuRetransmitOut: number | null;
  sfuCpuPct: number | null;
  sfuRssBytes: number | null;
};

export type StoredSystemSnapshot = Omit<SystemSnapshot, 'at'> & { at: number; dbBytes: number | null };

const number = (value: unknown): number => Number(value) || 0;
const rounded = (value: number | null): number | null => (value === null ? null : Math.round(value));
const maybeNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function createSystemSnapshotRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** Writes the minute; the database measures its own size in the same statement. */
  async function record(snapshot: SystemSnapshot): Promise<void> {
    const values = {
      at: snapshot.at,
      cpu_pct: snapshot.cpuPct,
      load1: snapshot.load1,
      mem_used_bytes: Math.round(snapshot.memUsedBytes),
      mem_total_bytes: Math.round(snapshot.memTotalBytes),
      disk_used_bytes: snapshot.diskUsedBytes === null ? null : Math.round(snapshot.diskUsedBytes),
      disk_total_bytes: snapshot.diskTotalBytes === null ? null : Math.round(snapshot.diskTotalBytes),
      db_bytes: sql<string>`pg_database_size(current_database())`,
      api_rss_bytes: Math.round(snapshot.apiRssBytes),
      event_loop_p99_ms: snapshot.eventLoopP99Ms,
      ws_connections: snapshot.wsConnections,
      guest_connections: snapshot.guestConnections,
      voice_peers: snapshot.voicePeers,
      voice_rooms: snapshot.voiceRooms,
      http_requests: snapshot.httpRequests,
      http_5xx: snapshot.http5xx,
      http_avg_ms: snapshot.httpAvgMs,
      sfu_bytes_in: rounded(snapshot.sfuBytesIn),
      sfu_bytes_out: rounded(snapshot.sfuBytesOut),
      sfu_packets_in: rounded(snapshot.sfuPacketsIn),
      sfu_lost_in: rounded(snapshot.sfuLostIn),
      sfu_packets_out: rounded(snapshot.sfuPacketsOut),
      sfu_lost_out: rounded(snapshot.sfuLostOut),
      sfu_retransmit_out: rounded(snapshot.sfuRetransmitOut),
      sfu_cpu_pct: snapshot.sfuCpuPct,
      sfu_rss_bytes: rounded(snapshot.sfuRssBytes)
    };
    await db
      .insertInto('system_snapshots')
      .values(values)
      .onConflict((conflict) =>
        conflict.column('at').doUpdateSet((eb) => ({
          cpu_pct: eb.ref('excluded.cpu_pct'),
          load1: eb.ref('excluded.load1'),
          mem_used_bytes: eb.ref('excluded.mem_used_bytes'),
          mem_total_bytes: eb.ref('excluded.mem_total_bytes'),
          disk_used_bytes: eb.ref('excluded.disk_used_bytes'),
          disk_total_bytes: eb.ref('excluded.disk_total_bytes'),
          db_bytes: eb.ref('excluded.db_bytes'),
          api_rss_bytes: eb.ref('excluded.api_rss_bytes'),
          event_loop_p99_ms: eb.ref('excluded.event_loop_p99_ms'),
          ws_connections: eb.ref('excluded.ws_connections'),
          guest_connections: eb.ref('excluded.guest_connections'),
          voice_peers: eb.ref('excluded.voice_peers'),
          voice_rooms: eb.ref('excluded.voice_rooms'),
          // Two ticks in one minute (a restart) both answered requests.
          http_requests: sql<number>`system_snapshots.http_requests + excluded.http_requests`,
          http_5xx: sql<number>`system_snapshots.http_5xx + excluded.http_5xx`,
          http_avg_ms: eb.ref('excluded.http_avg_ms'),
          // A restart's first tick only sets LiveKit's baseline: keep what the minute already had.
          sfu_bytes_in: sql<string | null>`coalesce(excluded.sfu_bytes_in, system_snapshots.sfu_bytes_in)`,
          sfu_bytes_out: sql<string | null>`coalesce(excluded.sfu_bytes_out, system_snapshots.sfu_bytes_out)`,
          sfu_packets_in: sql<string | null>`coalesce(excluded.sfu_packets_in, system_snapshots.sfu_packets_in)`,
          sfu_lost_in: sql<string | null>`coalesce(excluded.sfu_lost_in, system_snapshots.sfu_lost_in)`,
          sfu_packets_out: sql<string | null>`coalesce(excluded.sfu_packets_out, system_snapshots.sfu_packets_out)`,
          sfu_lost_out: sql<string | null>`coalesce(excluded.sfu_lost_out, system_snapshots.sfu_lost_out)`,
          sfu_retransmit_out: sql<
            string | null
          >`coalesce(excluded.sfu_retransmit_out, system_snapshots.sfu_retransmit_out)`,
          sfu_cpu_pct: sql<number | null>`coalesce(excluded.sfu_cpu_pct, system_snapshots.sfu_cpu_pct)`,
          sfu_rss_bytes: sql<string | null>`coalesce(excluded.sfu_rss_bytes, system_snapshots.sfu_rss_bytes)`
        }))
      )
      .execute();
  }

  async function pruneBefore(cutoff: Date): Promise<number> {
    const result = await db.deleteFrom('system_snapshots').where('at', '<', cutoff).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async function latest(): Promise<StoredSystemSnapshot | null> {
    const row = await db.selectFrom('system_snapshots').selectAll().orderBy('at', 'desc').limit(1).executeTakeFirst();
    return row ? fromRow(row) : null;
  }

  /**
   * The minutes from `since` to `until` folded into buckets of `bucketSeconds`: gauges
   * keep the bucket's highest value, requests are summed and their average
   * time is weighted by count. Media traffic keeps its busiest minute; media
   * packets and their losses are summed, so a loss share over the bucket is exact.
   */
  async function buckets(since: Date, until: Date, bucketSeconds: number): Promise<StoredSystemSnapshot[]> {
    // A literal, not a parameter: GROUP BY and the select list must be the
    // same expression, and two parameters are two expressions to Postgres.
    const seconds = sql.lit(Math.max(1, Math.floor(bucketSeconds)));
    const bucket = sql<Date>`date_bin(make_interval(secs => ${seconds}), at, TIMESTAMPTZ '2000-01-01 00:00:00+00')`;
    const rows = await db
      .selectFrom('system_snapshots')
      .select((eb) => [
        bucket.as('at'),
        eb.fn.max('cpu_pct').as('cpu_pct'),
        eb.fn.max('load1').as('load1'),
        eb.fn.max('mem_used_bytes').as('mem_used_bytes'),
        eb.fn.max('mem_total_bytes').as('mem_total_bytes'),
        eb.fn.max('disk_used_bytes').as('disk_used_bytes'),
        eb.fn.max('disk_total_bytes').as('disk_total_bytes'),
        eb.fn.max('db_bytes').as('db_bytes'),
        eb.fn.max('api_rss_bytes').as('api_rss_bytes'),
        eb.fn.max('event_loop_p99_ms').as('event_loop_p99_ms'),
        eb.fn.max('ws_connections').as('ws_connections'),
        eb.fn.max('guest_connections').as('guest_connections'),
        eb.fn.max('voice_peers').as('voice_peers'),
        eb.fn.max('voice_rooms').as('voice_rooms'),
        eb.fn.sum<string>('http_requests').as('http_requests'),
        eb.fn.sum<string>('http_5xx').as('http_5xx'),
        sql<
          number | null
        >`sum(http_avg_ms * http_requests) / nullif(sum(http_requests) FILTER (WHERE http_avg_ms IS NOT NULL), 0)`.as(
          'http_avg_ms'
        ),
        eb.fn.max('sfu_bytes_in').as('sfu_bytes_in'),
        eb.fn.max('sfu_bytes_out').as('sfu_bytes_out'),
        eb.fn.sum<string | null>('sfu_packets_in').as('sfu_packets_in'),
        eb.fn.sum<string | null>('sfu_lost_in').as('sfu_lost_in'),
        eb.fn.sum<string | null>('sfu_packets_out').as('sfu_packets_out'),
        eb.fn.sum<string | null>('sfu_lost_out').as('sfu_lost_out'),
        eb.fn.sum<string | null>('sfu_retransmit_out').as('sfu_retransmit_out'),
        eb.fn.max('sfu_cpu_pct').as('sfu_cpu_pct'),
        eb.fn.max('sfu_rss_bytes').as('sfu_rss_bytes')
      ])
      .where('at', '>=', since)
      .where('at', '<=', until)
      .groupBy(bucket)
      .orderBy(bucket)
      .execute();
    return rows.map(fromRow);
  }

  return Object.freeze({ record, pruneBefore, latest, buckets });
}

function fromRow(row: Record<string, unknown>): StoredSystemSnapshot {
  return {
    at: epochMillis(row.at) ?? Number.NaN,
    cpuPct: maybeNumber(row.cpu_pct),
    load1: number(row.load1),
    memUsedBytes: number(row.mem_used_bytes),
    memTotalBytes: number(row.mem_total_bytes),
    diskUsedBytes: maybeNumber(row.disk_used_bytes),
    diskTotalBytes: maybeNumber(row.disk_total_bytes),
    dbBytes: maybeNumber(row.db_bytes),
    apiRssBytes: number(row.api_rss_bytes),
    eventLoopP99Ms: number(row.event_loop_p99_ms),
    wsConnections: number(row.ws_connections),
    guestConnections: number(row.guest_connections),
    voicePeers: number(row.voice_peers),
    voiceRooms: number(row.voice_rooms),
    httpRequests: number(row.http_requests),
    http5xx: number(row.http_5xx),
    httpAvgMs: maybeNumber(row.http_avg_ms),
    sfuBytesIn: maybeNumber(row.sfu_bytes_in),
    sfuBytesOut: maybeNumber(row.sfu_bytes_out),
    sfuPacketsIn: maybeNumber(row.sfu_packets_in),
    sfuLostIn: maybeNumber(row.sfu_lost_in),
    sfuPacketsOut: maybeNumber(row.sfu_packets_out),
    sfuLostOut: maybeNumber(row.sfu_lost_out),
    sfuRetransmitOut: maybeNumber(row.sfu_retransmit_out),
    sfuCpuPct: maybeNumber(row.sfu_cpu_pct),
    sfuRssBytes: maybeNumber(row.sfu_rss_bytes)
  };
}

export type SystemSnapshotRepository = ReturnType<typeof createSystemSnapshotRepository>;
