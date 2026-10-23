// A stay in voice from the VoiceRoom Android app is stored as its own client
// kind and read back as one; the app counts as mobile in daily activity; and a
// rollback turns the app's stays back into phone stays before the older check
// returns.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createActivityRepository } from '../src/domains/account/activity.repository.ts';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('voice_sessions accepts mobile_app, and a rollback stores it as mobile', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('porch', '', false, 'Крыльцо')`);
  const stay = (client: string) =>
    pool.query(
      `INSERT INTO voice_sessions (room_id, joined_at, left_at, client)
       VALUES ('porch', now() - interval '1 minute', now(), $1)`,
      [client]
    );
  const clients = async () => {
    const { rows } = await pool.query<{ client: string | null }>('SELECT client FROM voice_sessions');
    return rows.map((row) => row.client);
  };

  await stay('mobile_app');
  await assert.rejects(stay('fridge'), /voice_sessions_client_check/);

  const { stays } = await createAdminRoomsRepository({ pool }).history({ roomId: 'porch' });
  assert.deepEqual(
    stays.map((one) => one.client),
    ['mobile_app']
  );

  await rollBackThrough(databaseUrl, '20261023120000_allow_mobile_app_client');
  assert.deepEqual(await clients(), ['mobile']);
  await assert.rejects(stay('mobile_app'), /voice_sessions_client_check/);

  await runMigrations({ databaseUrl, logger: SILENT });
  await stay('mobile_app');
  assert.deepEqual((await clients()).sort(), ['mobile', 'mobile_app']);
});

test('a day in the Android app marks the account active on mobile', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);

  await createActivityRepository({ pool }).recordActivity([{ userId: 'u1', day: '2026-10-23', client: 'mobile_app' }]);
  const { rows } = await pool.query<{ desktop_app: boolean; mobile: boolean; browser: boolean }>(
    `SELECT desktop_app, mobile, browser FROM user_activity_days WHERE user_id = 'u1'`
  );
  assert.deepEqual(rows, [{ desktop_app: false, mobile: true, browser: false }]);
});
