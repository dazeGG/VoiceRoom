// Who was active or in voice is kept per person for VOICE_HISTORY_KEEP_DAYS:
// the daily roll-up turns older days into counts and freezes finished signup
// weeks, so the product page reads the same numbers as before while the
// per-person rows are gone; a stay never keeps a city, and the migration rolls
// back cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityRepository } from '../src/domains/account/activity.repository.ts';
import { createAdminStatsRepository } from '../src/domains/admin/admin-stats.repository.ts';
import { createVoiceSessionRepository } from '../src/domains/rooms/voice-session.repository.ts';
import { apiMaintenanceTasks, type ApiMaintenanceDeps } from '../src/app/maintenance-tasks.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
// 15:00 in Moscow: today is 26 October, and the per-person days end after 28 July.
const NOW = Date.parse('2026-10-26T12:00:00Z');

function depsWith(overrides: Partial<ApiMaintenanceDeps>): ApiMaintenanceDeps {
  const none = () => null;
  return {
    pruneRooms: () => Promise.resolve(),
    sampleProduct: () => Promise.resolve(),
    sampleSystem: () => Promise.resolve(),
    users: () => ({ pruneSessions: () => Promise.resolve(), pruneLoginEvents: () => Promise.resolve() }),
    finalizeDueDeletions: () => Promise.resolve(),
    linkPreviews: none,
    rooms: () => ({}),
    voiceSessions: none,
    callFeedback: none,
    roomBans: none,
    productStats: none,
    activity: none,
    retention: { intervalMs: 0, keepDeletedMs: 0 },
    ...overrides
  };
}

function rollupTask(deps: ApiMaintenanceDeps) {
  const task = apiMaintenanceTasks(deps).find((one) => one.name === 'activity_rollup');
  assert.ok(task, 'the roll-up task');
  return task;
}

test('old days become counts: the product numbers stay, whose they were goes', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, password_hash, created_at) VALUES
       ('u-old', 'old', 'x', '2026-04-27T09:00:00Z'), ('u-new', 'new', 'x', '2026-10-15T09:00:00Z')`
  );
  await pool.query(
    `INSERT INTO user_activity_days (user_id, day, desktop_app, browser) VALUES
       ('u-old', '2026-05-01', true, false), ('u-old', '2026-05-02', false, true),
       ('u-old', '2026-10-20', false, true), ('u-new', '2026-10-25', true, false)`
  );
  await pool.query(
    `INSERT INTO voice_sessions (user_id, room_id, client, os, browser, joined_at, left_at) VALUES
       ('u-old', NULL, 'desktop_app', 'Windows', 'VoiceRoom', '2026-05-01T07:00:00Z', '2026-05-01T08:00:00Z'),
       (NULL, NULL, 'browser', 'Windows', 'Chrome', '2026-05-01T07:10:00Z', '2026-05-01T07:40:00Z'),
       ('u-old', 'kitchen', 'browser', 'Windows', 'Chrome', '2026-10-20T07:00:00Z', '2026-10-20T08:00:00Z')`
  );

  const stats = createAdminStatsRepository({ pool });
  const read = async () => ({
    old: await stats.productDays('2026-05-01', '2026-05-02'),
    recent: await stats.productDays('2026-10-20', '2026-10-25'),
    retention: await stats.retention(52)
  });
  const before = await read();
  assert.equal(before.old.days[0]?.activeAccounts, 1);
  assert.equal(before.old.days[0]?.voiceAccountHours, 1);
  assert.equal(before.old.days[0]?.voiceGuestHours, 0.5);

  const task = rollupTask(
    depsWith({
      productStats: () => stats,
      activity: () => createActivityRepository({ pool }),
      voiceSessions: () => createVoiceSessionRepository({ pool }),
      now: () => NOW
    })
  );
  await task.run();
  const counted = await pool.query<{ day: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM product_days ORDER BY day`
  );
  assert.deepEqual(
    counted.rows.map((row) => row.day),
    ['2026-05-01', '2026-05-02'],
    'both old days counted'
  );
  assert.deepEqual(await read(), before, 'the product page reads the same numbers from the counts');

  const activity = await pool.query<{ user_id: string; day: string }>(
    `SELECT user_id, to_char(day, 'YYYY-MM-DD') AS day FROM user_activity_days ORDER BY day`
  );
  assert.deepEqual(
    activity.rows.map((row) => row.day),
    ['2026-10-20', '2026-10-25'],
    'only the kept days stay per person'
  );
  const stays = await pool.query<{
    user_id: string | null;
    client: string | null;
    os: string | null;
    browser: string | null;
    room_id: string | null;
  }>(`SELECT user_id, client, os, browser, room_id FROM voice_sessions ORDER BY joined_at`);
  assert.deepEqual(stays.rows, [
    { user_id: null, client: null, os: null, browser: null, room_id: null },
    { user_id: null, client: null, os: null, browser: null, room_id: null },
    { user_id: 'u-old', client: 'browser', os: 'Windows', browser: 'Chrome', room_id: 'kitchen' }
  ]);

  // A second run finds nothing left to count or forget and changes nothing.
  await task.run();
  assert.equal(await stats.rollUp('2026-07-28', '2026-10-26'), 0);
  assert.deepEqual(await read(), before);
});

test('the roll-up runs once a Moscow day: it counts first, then the owners forget', async () => {
  let now = Date.parse('2026-10-26T20:30:00Z'); // 23:30 in Moscow
  const calls: string[] = [];
  const task = rollupTask(
    depsWith({
      productStats: () => ({
        rollUp: (cutoffDay: string, today: string) => {
          calls.push(`count before ${cutoffDay} on ${today}`);
          return Promise.resolve(0);
        }
      }),
      activity: () => ({
        forgetBefore: (cutoffDay: string) => {
          calls.push(`forget activity before ${cutoffDay}`);
          return Promise.resolve(0);
        }
      }),
      voiceSessions: () => ({
        forgetRoomsBefore: () => Promise.resolve(0),
        forgetAccountsBefore: (cutoffDay: string) => {
          calls.push(`forget stays before ${cutoffDay}`);
          return Promise.resolve(0);
        }
      }),
      now: () => now
    })
  );
  const tick = async () => {
    if (task.enabled?.() ?? true) await task.run();
  };

  await tick();
  await tick();
  now += 20 * 60_000; // 23:50, the same Moscow day
  await tick();
  assert.deepEqual(calls, [
    'count before 2026-07-28 on 2026-10-26',
    'forget activity before 2026-07-28',
    'forget stays before 2026-07-28'
  ]);
  now += 20 * 60_000; // 00:10, the next one
  await tick();
  assert.equal(calls.length, 6);
  assert.equal(calls[3], 'count before 2026-07-29 on 2026-10-27');
});

test('the roll-up tables roll back, and the stays lose their cities on the way up', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const tables = async () => {
    const { rows } = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.product_days')::text AS name UNION ALL SELECT to_regclass('public.retention_weeks')::text`
    );
    return rows.map((row) => row.name);
  };
  assert.deepEqual(await tables(), ['product_days', 'retention_weeks']);

  await rollBackThrough(databaseUrl, '20261026113000_roll_up_old_activity');
  assert.deepEqual(await tables(), [null, null]);
  await pool.query(
    `INSERT INTO voice_sessions (room_id, location, joined_at, left_at) VALUES ('r1', 'Воронеж, Россия', now(), now())`
  );
  await runMigrations({ databaseUrl, logger: SILENT });
  assert.deepEqual(await tables(), ['product_days', 'retention_weeks']);
  const { rows } = await pool.query<{ location: string | null }>('SELECT location FROM voice_sessions');
  assert.deepEqual(rows, [{ location: null }]);
});
