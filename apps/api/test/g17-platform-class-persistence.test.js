'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');
const { test } = require('node:test');
const { classifyPlatform } = require('@voice-room/shared/platform-class');
const { createPushStore } = require('../src/lib/push-store');
const { createTestDatabase } = require('./db-harness');

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/migrations');
const BASE_TIMESTAMP = 20260711130000;
const PLATFORM_TIMESTAMP = 20260718120000;
const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const SIGNAL_KEYS = ['desktopBridge', 'maxTouchPoints', 'platform', 'platformClass', 'userAgent', 'userAgentData', 'userAgentDataMobile'];

async function migrate(databaseUrl, count, direction = 'up') {
  return runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: 'g17_migrations',
    count,
    timestamp: direction === 'up',
    singleTransaction: true,
    checkOrder: true,
    logger: SILENT,
    noLock: true
  });
}

async function withClient(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

test('G17-A01 fresh migration is idempotent and application rollback preserves N-1 reads', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);

  const applied = await migrate(databaseUrl, PLATFORM_TIMESTAMP);
  assert.ok(applied.some((migration) => String(migration?.name || migration).startsWith(String(PLATFORM_TIMESTAMP))));
  assert.deepEqual(await migrate(databaseUrl, PLATFORM_TIMESTAMP), []);

  await withClient(databaseUrl, async (client) => {
    const type = await client.query(`SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = enumtypid WHERE typname = 'push_subscription_platform_class' ORDER BY enumsortorder`);
    assert.deepEqual(type.rows.map(({ enumlabel }) => enumlabel), ['desktop', 'mobile', 'unknown']);
    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'push_subscriptions'`);
    assert.ok(columns.rows.some(({ column_name }) => column_name === 'platform_class'));
    await client.query(`SELECT id, user_id, endpoint, p256dh, auth, created_at, last_success_at, metadata FROM push_subscriptions`);
  });

  await migrate(databaseUrl, 1, 'down');
  await withClient(databaseUrl, async (client) => {
    const { rows: [{ column_exists }] } = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'push_subscriptions' AND column_name = 'platform_class') AS column_exists`);
    assert.equal(column_exists, false);
    await client.query(`SELECT id, user_id, endpoint, p256dh, auth, created_at, last_success_at, metadata FROM push_subscriptions`);
  });
});

test('G17-A01 upgrade reclassifies 10k rows within five seconds and removes every raw platform signal', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);
  await migrate(databaseUrl, BASE_TIMESTAMP);

  await withClient(databaseUrl, async (client) => {
    const userId = 'g17-user';
    await client.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'g17user', 'G17 User', 'fixture')`, [userId]);
    await client.query(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, metadata)
      SELECT
        'g17-' || value, $1, 'https://push.example/' || value, 'key-' || value, 'auth-' || value,
        CASE value % 7
          WHEN 0 THEN '{"userAgent":"Mozilla/5.0 (iPhone; Mobile)","retained":"ios"}'::jsonb
          WHEN 1 THEN '{"userAgent":"Mozilla/5.0 (Linux; Android 14; Mobile)","retained":"android"}'::jsonb
          WHEN 2 THEN '{"userAgent":"Mozilla/5.0 (Macintosh)","platform":"MacIntel","maxTouchPoints":5}'::jsonb
          WHEN 3 THEN '{"userAgentDataMobile":false,"userAgent":"Mobile","retained":"ch-desktop"}'::jsonb
          WHEN 4 THEN '{"userAgentData":{"mobile":true},"userAgent":"Windows NT 10.0"}'::jsonb
          WHEN 5 THEN '{"desktopBridge":true,"userAgent":"iPhone"}'::jsonb
          ELSE '{"userAgent":"???","retained":"unknown"}'::jsonb
        END
      FROM generate_series(1, 10000) AS value
    `, [userId]);
  });

  const startedAt = performance.now();
  await migrate(databaseUrl, PLATFORM_TIMESTAMP);
  const durationMs = performance.now() - startedAt;
  assert.ok(durationMs <= 5000, `10k migration took ${durationMs.toFixed(1)}ms`);

  await withClient(databaseUrl, async (client) => {
    const { rows: [counts] } = await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE platform_class = 'mobile')::int AS mobile, count(*) FILTER (WHERE platform_class = 'desktop')::int AS desktop, count(*) FILTER (WHERE platform_class = 'unknown')::int AS unknown FROM push_subscriptions`);
    assert.deepEqual(counts, { total: 10000, mobile: 4286, desktop: 4286, unknown: 1428 });
    const { rows: [{ raw_count }] } = await client.query(`SELECT count(*)::int AS raw_count FROM push_subscriptions WHERE metadata ?| $1::text[]`, [SIGNAL_KEYS]);
    assert.equal(raw_count, 0);
    const { rows: [{ retained }] } = await client.query(`SELECT metadata->>'retained' AS retained FROM push_subscriptions WHERE id = 'g17-3'`);
    assert.equal(retained, 'ch-desktop');
  });
});

test('G17-A02 store and PostgreSQL upgrade equal the shared classifier corpus without persisting signals', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);
  await migrate(databaseUrl, PLATFORM_TIMESTAMP);
  const store = createPushStore({ databaseUrl, logger: SILENT });
  t.after(() => store.close());

  const corpus = [
    { userAgent: 'Mozilla/5.0 (iPhone; Mobile)' },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)' },
    { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgentDataMobile: false, userAgent: 'Mobile' },
    { desktopBridge: true, userAgent: 'iPhone' },
    { userAgent: '???' }
  ];

  await withClient(databaseUrl, async (client) => {
    await client.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('g17-store-user', 'g17store', 'G17 Store', 'fixture')`);
  });
  for (const [index, signals] of corpus.entries()) {
    const stored = await store.upsert({
      userId: 'g17-store-user',
      subscription: { endpoint: `https://push.example/corpus-${index}`, keys: { p256dh: `key-${index}`, auth: `auth-${index}` } },
      metadata: { ...signals, retained: `row-${index}` }
    });
    assert.equal(stored.platformClass, classifyPlatform(signals));
    assert.deepEqual(stored.metadata, { retained: `row-${index}` });
  }
});

test('G17-A02 lock timeout rolls the target migration back in at most five seconds', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const migrationSource = fs.readFileSync(path.join(MIGRATIONS_DIR, '20260718120000_add_push_subscription_platform_class.js'), 'utf8');
  assert.match(migrationSource, /SET LOCAL lock_timeout = '5s'/);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  t.after(cleanup);
  await migrate(databaseUrl, BASE_TIMESTAMP);

  const blocker = new Client({ connectionString: databaseUrl });
  await blocker.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE push_subscriptions IN ACCESS EXCLUSIVE MODE');
  const startedAt = performance.now();
  await assert.rejects(migrate(databaseUrl, PLATFORM_TIMESTAMP), (error) => error?.code === '55P03');
  const durationMs = performance.now() - startedAt;
  assert.ok(durationMs >= 4500 && durationMs <= 5200, `five-second lock timeout completed in ${durationMs.toFixed(1)}ms`);
  await blocker.query('ROLLBACK');
  await blocker.end();

  await withClient(databaseUrl, async (client) => {
    const { rows: [{ column_exists }] } = await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'push_subscriptions' AND column_name = 'platform_class') AS column_exists`);
    const { rows: [{ type_exists }] } = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'push_subscription_platform_class') AS type_exists`);
    assert.equal(column_exists, false);
    assert.equal(type_exists, false);
  });
});
