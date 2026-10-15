// The server's own monitoring: each maintenance tick turns the host's counters
// into this minute's numbers, the repository keeps a minute once (summing the
// requests of two ticks in it), folds minutes into buckets for the admin
// panel, prunes what is older than its window, and the migration rolls back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

import { cpuPercent, createSystemSampler, type HttpTotals } from '../src/domains/ops/system-snapshot.service.ts';
import { createSystemSnapshotRepository, type SystemSnapshot } from '../src/domains/ops/system-snapshot.repository.ts';
import { createHostProbe, type CpuTimes, type HostProbe } from '../src/platform/host-probe.ts';
import { httpTotals, recordHttpRequest, resetMetricsForTest } from '../src/lib/metrics.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const GB = 1024 ** 3;

function fakeHost(overrides: Partial<HostProbe> = {}) {
  const cpu: CpuTimes[] = [];
  const host: HostProbe = {
    cpuTimes: () => cpu.shift() ?? { idle: 0, total: 0 },
    load1: () => 0.5,
    memory: () => ({ totalBytes: 4 * GB, freeBytes: 1 * GB }),
    disk: async () => ({ totalBytes: 100 * GB, freeBytes: 60 * GB }),
    rssBytes: () => 80 * 1024 * 1024,
    takeEventLoopP99Ms: () => 12,
    ...overrides
  };
  return { host, cpu };
}

test('cpu use is the busy share of the time between two readings', () => {
  assert.equal(cpuPercent(null, { idle: 10, total: 20 }), null);
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), null);
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 175, total: 300 }), 25);
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 300, total: 300 }), 0);
});

test('a tick writes the minute from the counters since the last tick and prunes the old ones', async () => {
  const { host, cpu } = fakeHost();
  cpu.push({ idle: 1000, total: 2000 }, { idle: 1060, total: 2100 }, { idle: 1100, total: 2200 });
  const http: HttpTotals[] = [
    { count: 10, errors5xx: 1, durationSecondsSum: 1 },
    { count: 14, errors5xx: 2, durationSecondsSum: 1.2 },
    { count: 14, errors5xx: 2, durationSecondsSum: 1.2 }
  ];
  const recorded: SystemSnapshot[] = [];
  const pruned: Date[] = [];
  let clock = Date.parse('2026-10-16T10:05:42Z');
  const sampler = createSystemSampler({
    host,
    http: () => http.shift()!,
    live: () => ({ wsConnections: 5, guestConnections: 1, voicePeers: 3, voiceRooms: 1 }),
    snapshots: () => ({
      record: async (snapshot) => {
        recorded.push(snapshot);
      },
      pruneBefore: async (cutoff) => {
        pruned.push(cutoff);
        return 0;
      }
    }),
    now: () => clock,
    keepMs: 60 * 60 * 1000
  });

  await sampler.sample();
  clock += 60_000;
  await sampler.sample();

  assert.equal(recorded.length, 2);
  const [first, second] = recorded;
  assert.equal(first!.at.toISOString(), '2026-10-16T10:05:00.000Z');
  assert.equal(first!.cpuPct, 40);
  assert.equal(first!.memUsedBytes, 3 * GB);
  assert.equal(first!.diskUsedBytes, 40 * GB);
  assert.equal(first!.diskTotalBytes, 100 * GB);
  assert.equal(first!.httpRequests, 4);
  assert.equal(first!.http5xx, 1);
  assert.equal(Math.round(first!.httpAvgMs!), 50);
  assert.deepEqual([first!.wsConnections, first!.guestConnections, first!.voicePeers, first!.voiceRooms], [5, 1, 3, 1]);
  assert.equal(first!.eventLoopP99Ms, 12);
  // A quiet minute has no average time, not a zero one.
  assert.equal(second!.httpRequests, 0);
  assert.equal(second!.httpAvgMs, null);
  assert.equal(second!.cpuPct, 60);
  assert.deepEqual(
    pruned.map((cutoff) => cutoff.toISOString()),
    ['2026-10-16T09:05:00.000Z', '2026-10-16T09:06:00.000Z']
  );
});

test('a host without disk figures and an API without a database still sample', async () => {
  const { host } = fakeHost({ disk: async () => null });
  const records: SystemSnapshot[] = [];
  const withDb = createSystemSampler({
    host,
    http: () => ({ count: 0, errors5xx: 0, durationSecondsSum: 0 }),
    live: () => ({ wsConnections: 0, guestConnections: 0, voicePeers: 0, voiceRooms: 0 }),
    snapshots: () => ({
      record: async (snapshot) => {
        records.push(snapshot);
      },
      pruneBefore: async () => 0
    })
  });
  await withDb.sample();
  assert.equal(records[0]!.diskUsedBytes, null);
  assert.equal(records[0]!.diskTotalBytes, null);

  const withoutDb = createSystemSampler({
    host,
    http: () => ({ count: 0, errors5xx: 0, durationSecondsSum: 0 }),
    live: () => ({ wsConnections: 0, guestConnections: 0, voicePeers: 0, voiceRooms: 0 }),
    snapshots: () => null
  });
  await assert.doesNotReject(withoutDb.sample());
});

test('the host probe reads this machine', async () => {
  const probe = createHostProbe({ diskPath: process.cwd() });
  const cpu = probe.cpuTimes();
  assert.ok(cpu.total > 0 && cpu.idle <= cpu.total);
  assert.ok(probe.memory().totalBytes > 0);
  assert.ok(probe.rssBytes() > 0);
  assert.ok(Number.isFinite(probe.load1()));
  const disk = await probe.disk();
  assert.ok(disk === null || disk.totalBytes > 0);
  assert.equal(await createHostProbe({ diskPath: '/no/such/path/here' }).disk(), null);
  // The first reading starts the histogram; the next reports what it measured.
  assert.equal(probe.takeEventLoopP99Ms(), 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(probe.takeEventLoopP99Ms() >= 0);
});

test('request totals add up every route and count the server errors', () => {
  resetMetricsForTest();
  recordHttpRequest({ method: 'GET', route: '/a', statusCode: 200, durationMs: 100 });
  recordHttpRequest({ method: 'GET', route: '/a', statusCode: 200, durationMs: 300 });
  recordHttpRequest({ method: 'POST', route: '/b', statusCode: 503, durationMs: 50 });
  assert.deepEqual(httpTotals(), { count: 3, errors5xx: 1, durationSecondsSum: 0.45 });
  resetMetricsForTest();
  assert.deepEqual(httpTotals(), { count: 0, errors5xx: 0, durationSecondsSum: 0 });
});

test('minutes are kept once, folded into buckets, pruned, and the migration rolls back', { skip }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await cleanup();
  });
  await runMigrations({ databaseUrl, logger: SILENT });
  const repository = createSystemSnapshotRepository({ pool });
  const minute = (at: string, overrides: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
    at: new Date(at),
    cpuPct: 10,
    load1: 0.2,
    memUsedBytes: 2 * GB,
    memTotalBytes: 4 * GB,
    diskUsedBytes: 10 * GB,
    diskTotalBytes: 50 * GB,
    apiRssBytes: 100,
    eventLoopP99Ms: 5,
    wsConnections: 2,
    guestConnections: 0,
    voicePeers: 1,
    voiceRooms: 1,
    httpRequests: 10,
    http5xx: 0,
    httpAvgMs: 20,
    ...overrides
  });

  assert.equal(await repository.latest(), null);
  await repository.record(minute('2026-10-16T10:00:00Z'));
  // A restart inside the minute: the requests of both ticks count.
  await repository.record(minute('2026-10-16T10:00:00Z', { httpRequests: 5, http5xx: 1, cpuPct: 30 }));
  await repository.record(minute('2026-10-16T10:01:00Z', { cpuPct: 90, httpRequests: 30, httpAvgMs: 40 }));
  await repository.record(minute('2026-10-16T10:02:00Z', { cpuPct: null, httpRequests: 0, httpAvgMs: null }));
  await repository.record(minute('2026-10-16T10:07:00Z', { diskUsedBytes: null, diskTotalBytes: null }));

  const latest = await repository.latest();
  assert.equal(latest!.at, Date.parse('2026-10-16T10:07:00Z'));
  assert.equal(latest!.diskUsedBytes, null);
  assert.ok(latest!.dbBytes! > 0, 'the database measures its own size');

  const rows = await pool.query<{ http_requests: number; http_5xx: number; cpu_pct: number }>(
    `SELECT http_requests, http_5xx, cpu_pct FROM system_snapshots WHERE at = '2026-10-16T10:00:00Z'`
  );
  assert.deepEqual(rows.rows, [{ http_requests: 15, http_5xx: 1, cpu_pct: 30 }]);

  const buckets = await repository.buckets(new Date('2026-10-16T09:00:00Z'), new Date('2026-10-16T12:00:00Z'), 300);
  assert.deepEqual(
    buckets.map((bucket) => new Date(bucket.at).toISOString()),
    ['2026-10-16T10:00:00.000Z', '2026-10-16T10:05:00.000Z']
  );
  const [busy] = buckets;
  assert.equal(busy!.cpuPct, 90, 'a gauge keeps its highest minute');
  assert.equal(busy!.httpRequests, 45);
  assert.equal(busy!.http5xx, 1);
  // (15 × 20 + 30 × 40) / 45: weighted by the requests of each minute.
  assert.equal(Math.round(busy!.httpAvgMs!), 33);
  assert.deepEqual(
    await repository.buckets(new Date('2026-10-16T11:00:00Z'), new Date('2026-10-16T12:00:00Z'), 60),
    []
  );
  // The end bounds the span: the minutes after it stay out.
  const early = await repository.buckets(new Date('2026-10-16T09:00:00Z'), new Date('2026-10-16T10:01:00Z'), 60);
  assert.deepEqual(
    early.map((bucket) => new Date(bucket.at).toISOString()),
    ['2026-10-16T10:00:00.000Z', '2026-10-16T10:01:00.000Z']
  );

  assert.equal(await repository.pruneBefore(new Date('2026-10-16T10:05:00Z')), 3);
  assert.equal((await pool.query('SELECT 1 FROM system_snapshots')).rowCount, 1);

  await rollBackThrough(databaseUrl, '20261016120000_create_system_snapshots');
  const gone = await pool.query(`SELECT to_regclass('public.system_snapshots') AS name`);
  assert.deepEqual(gone.rows, [{ name: null }]);
  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await repository.latest(), null);
});
