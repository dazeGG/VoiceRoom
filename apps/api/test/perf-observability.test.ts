// What says where the time goes, and what keeps one stuck query from stopping
// everything: request latency as a histogram, browsers' page measures, a pool
// that gives up instead of waiting forever, and Postgres naming its slow queries.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { createDbPool } from '../src/platform/db/pool.ts';
import * as metrics from '../src/lib/metrics.ts';
import { createTestDatabase } from './db-harness.ts';

const { createApiApp } = await import('../src/server.ts');
const skip = !process.env.TEST_DATABASE_URL;

function createApp(t: TestContext) {
  const app = createApiApp({
    store: {
      async countRooms() {
        return 0;
      },
      async getRoom() {
        return null;
      },
      async listSummaryRecipientUserIds() {
        return [];
      },
      async markRoomActive() {
        return null;
      },
      async markRoomEmpty() {
        return null;
      },
      async pruneRooms() {
        return false;
      }
    }
  });
  t.after(() => app.close());
  return app;
}

test('request latency is kept as a histogram, so a slow few do not hide in an average', () => {
  metrics.resetMetricsForTest();
  metrics.recordHttpRequest({ method: 'GET', route: '/api/x', statusCode: 200, durationMs: 40 });
  metrics.recordHttpRequest({ method: 'GET', route: '/api/x', statusCode: 200, durationMs: 40 });
  metrics.recordHttpRequest({ method: 'GET', route: '/api/x', statusCode: 500, durationMs: 3000 });

  const text = metrics.renderPrometheus();
  const line = (le: string) =>
    text
      .split('\n')
      .find((row) =>
        row.startsWith(`voice_room_api_http_latency_seconds_bucket{method="GET",route="/api/x",le="${le}"}`)
      );

  assert.match(line('0.05') ?? '', / 2$/);
  assert.match(line('2.5') ?? '', / 2$/);
  assert.match(line('5') ?? '', / 3$/);
  assert.match(line('+Inf') ?? '', / 3$/);
  assert.match(text, /voice_room_api_http_latency_seconds_count\{method="GET",route="\/api\/x"\} 3/);
});

test('a browser reports a page measure; it lands in a histogram with nothing of the visitor', async (t) => {
  metrics.resetMetricsForTest();
  const app = createApp(t);

  const answer = await app.inject({
    method: 'POST',
    url: '/api/client-vitals',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    payload: { name: 'LCP', value: 1500 }
  });

  assert.equal(answer.statusCode, 204);
  const text = metrics.renderPrometheus();
  assert.match(text, /voice_room_web_vital_bucket\{name="LCP",le="1800"\} 1/);
  assert.match(text, /voice_room_web_vital_bucket\{name="LCP",le="1200"\} 0/);
  assert.doesNotMatch(text, /203\.0\.113\.9/);
});

test('a page measure of an unknown name or an impossible value is refused', async (t) => {
  metrics.resetMetricsForTest();
  const app = createApp(t);

  for (const payload of [
    { name: 'NOPE', value: 1 },
    { name: 'LCP', value: -1 },
    { name: 'LCP', value: 1e9 }
  ]) {
    const answer = await app.inject({
      method: 'POST',
      url: '/api/client-vitals',
      headers: { 'content-type': 'application/json' },
      payload
    });
    assert.equal(answer.statusCode, 400, JSON.stringify(payload));
  }
  assert.doesNotMatch(metrics.renderPrometheus(), /voice_room_web_vital_bucket/);
});

test('a query past its time limit fails instead of holding its connection', { skip }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);
  const pool = createDbPool({ databaseUrl, logger: { error() {} }, statementTimeoutMs: 100 });
  try {
    await assert.rejects(pool.query('SELECT pg_sleep(5)'), { code: '57014' });
  } finally {
    await pool.end();
  }
});

test('a pool with every connection taken fails a request instead of keeping it waiting', { skip }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);
  const pool = createDbPool({ databaseUrl, logger: { error() {} }, max: 1, connectionWaitMs: 100 });
  const held = await pool.connect();
  try {
    await assert.rejects(pool.query('SELECT 1'), /timeout/i);
  } finally {
    held.release();
    await pool.end();
  }
});

test('production Postgres names its slow queries, without the values bound to them', () => {
  const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /shared_preload_libraries=pg_stat_statements/);
  assert.match(compose, /log_min_duration_statement=/);
  assert.match(compose, /log_parameter_max_length=0/);
});
