// Product analytics in the database: a signed-in request marks the account's
// day, the maintenance tick writes the quarter hour's peaks, and the
// migrations roll back cleanly. The md5-keyed analytics views served the old
// status dashboard and are gone since 2.9.1; a rollback past that brings them
// back without raw ids.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

import { createActivityRepository } from '../src/domains/account/activity.repository.ts';
import { createProductSnapshotRepository } from '../src/domains/ops/product-snapshot.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';
import { registerAccount, request, startApiServer } from './fakes/server-process.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const DESKTOP_APP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 VoiceRoom/1.4.6 Chrome/138.0 Electron/37.0';

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('a signed-in request marks the day and the running API writes the live peaks', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-analytics-',
    env: { AUTH_RATE_LIMIT: '0', ROOM_PRUNE_INTERVAL_MS: '200' }
  });
  const db = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => db.end());

  const cookie = await registerAccount(socketPath, 'ada');
  const me = await request<{ user: { id: string } }>(socketPath, {
    pathname: '/api/auth/me',
    cookie,
    headers: { 'User-Agent': DESKTOP_APP }
  });
  assert.equal(me.status, 200);
  const userId = me.body.user.id;

  const days = await waitFor(
    () =>
      db
        .query<{ user_id: string; desktop_app: boolean }>('SELECT user_id, desktop_app FROM user_activity_days')
        .then((result) => result.rows),
    (rows) => rows.some((row) => row.desktop_app)
  );
  assert.equal(days.length, 1);
  assert.equal(days[0]!.user_id, userId);
  assert.equal(days[0]!.desktop_app, true);

  const snapshots = await waitFor(
    () => db.query<{ at: Date }>('SELECT at FROM product_snapshots').then((result) => result.rows),
    (rows) => rows.length > 0
  );
  assert.ok(snapshots.length > 0, 'the maintenance tick wrote a snapshot');
});

test(
  'activity and peaks merge on conflict, a rollback brings back views that hide ids, and the migrations roll back',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl } = await createTestDatabase(t);
    const pool = new Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await pool.end();
      await cleanup();
    });
    await runMigrations({ databaseUrl, logger: SILENT });
    await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);

    const activity = createActivityRepository({ pool });
    await activity.recordActivity([{ userId: 'u1', day: '2026-10-15', client: 'browser' }]);
    await activity.recordActivity([
      { userId: 'u1', day: '2026-10-15', client: 'mobile' },
      { userId: 'u1', day: '2026-10-16', client: null }
    ]);
    const days = await pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, desktop_app, mobile, browser FROM user_activity_days ORDER BY day`
    );
    assert.deepEqual(days.rows, [
      { day: '2026-10-15', desktop_app: false, mobile: true, browser: true },
      { day: '2026-10-16', desktop_app: false, mobile: false, browser: false }
    ]);

    const snapshots = createProductSnapshotRepository({ pool });
    const at = new Date('2026-10-15T12:00:00Z');
    await snapshots.recordPeaks({ at, onlineAccounts: 3, guestConnections: 1, voicePeers: 2, voiceRooms: 1 });
    await snapshots.recordPeaks({ at, onlineAccounts: 2, guestConnections: 4, voicePeers: 2, voiceRooms: 2 });
    const schema = async () =>
      (await pool.query<{ name: string | null }>(`SELECT to_regnamespace('analytics')::text AS name`)).rows[0]?.name ??
      null;
    assert.equal(await schema(), null, 'the analytics schema is gone');
    await rollBackThrough(databaseUrl, '20261018120000_drop_analytics_schema');
    assert.equal(await schema(), 'analytics');

    const peaks = await pool.query(
      'SELECT online_accounts, guest_connections, voice_peers, voice_rooms FROM analytics.snapshots'
    );
    assert.deepEqual(peaks.rows, [{ online_accounts: 3, guest_connections: 4, voice_peers: 2, voice_rooms: 2 }]);

    await pool.query(
      `INSERT INTO rooms (id, creator_ip, is_static, created_at, updated_at) VALUES ('join-code', '', false, now(), now())`
    );
    await pool.query(
      `INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at, author_user_id)
     VALUES ('m1', 'join-code', 'p1', 'Ада', 'секрет', now(), 'u1')`
    );
    await pool.query(
      `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at) VALUES ('join-code', NULL, now(), now())`
    );
    const exposed = await pool.query<{ row: string }>(`
    SELECT row_to_json(a)::text AS row FROM analytics.accounts a
    UNION ALL SELECT row_to_json(m)::text FROM analytics.messages m
    UNION ALL SELECT row_to_json(r)::text FROM analytics.rooms r
    UNION ALL SELECT row_to_json(v)::text FROM analytics.voice_sessions v`);
    assert.equal(exposed.rows.length, 4);
    for (const { row } of exposed.rows) {
      for (const secret of ['"u1"', 'ada', 'join-code', 'секрет', 'Ада']) {
        assert.ok(!row.includes(secret), `${row} leaks ${secret}`);
      }
    }

    const exists = async () => {
      const { rows } = await pool.query<{ tables: string | null; peaks: string | null }>(
        `SELECT to_regclass('public.user_activity_days')::text AS tables, to_regclass('public.product_snapshots')::text AS peaks`
      );
      return Boolean(rows[0]?.tables && rows[0]?.peaks);
    };
    assert.equal(await exists(), true);
    await rollBackThrough(databaseUrl, '20261015140000_create_product_analytics');
    const after = await pool.query(
      `SELECT to_regclass('public.user_activity_days') AS a, to_regclass('public.product_snapshots') AS b,
            to_regnamespace('analytics') AS c`
    );
    assert.deepEqual(after.rows, [{ a: null, b: null, c: null }]);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.equal(await exists(), true);
    assert.equal(await schema(), null);
  }
);
