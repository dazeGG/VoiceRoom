// The device_tokens table checks its provider and token, keeps one row per
// provider and token, goes away with its session or account, and a rollback
// removes it again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';

import { runMigrations } from '../src/lib/migrate.ts';
import { queryRow } from './helpers/checked.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('device_tokens checks its values, follows its session, and rolls back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const exists = async () =>
    (
      await queryRow(
        pool,
        Type.Object({ name: Type.Union([Type.String(), Type.Null()]) }),
        `SELECT to_regclass('public.device_tokens') AS name`
      )
    ).name !== null;
  const count = async () =>
    (await queryRow(pool, Type.Object({ count: Type.Integer() }), 'SELECT count(*)::int AS count FROM device_tokens'))
      .count;

  assert.equal(await exists(), true);
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x'), ('u2', 'bob', 'x')`);
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ('s1', 'u1', now() + interval '1 day'), ('s2', 'u2', now() + interval '1 day')`
  );
  const register = (id: string, token: string, provider = 'rustore', session = 's1', user = 'u1') =>
    pool.query(
      `INSERT INTO device_tokens (id, user_id, session_id, provider, token, app_version)
       VALUES ($1, $2, $3, $4, $5, '1.0.0')`,
      [id, user, session, provider, token]
    );

  await register('d1', 'token-1');
  await register('d2', 'token-2', 'rustore', 's2', 'u2');
  await assert.rejects(register('d3', 'token-3', 'fcm'), /device_tokens_provider_check/);
  await assert.rejects(register('d3', ''), /device_tokens_token_check/);
  await assert.rejects(register('d3', 'x'.repeat(1025)), /too long/);
  await assert.rejects(register('d3', 'token-1', 'rustore', 's2', 'u2'), /device_tokens_provider_token_key/);
  const stamps = await queryRow(
    pool,
    Type.Object({ app_version: Type.String(), fresh: Type.Boolean() }),
    `SELECT app_version, created_at IS NOT NULL AND last_seen_at IS NOT NULL AS fresh FROM device_tokens WHERE id = 'd1'`
  );
  assert.deepEqual(stamps, { app_version: '1.0.0', fresh: true });

  await pool.query(`DELETE FROM sessions WHERE id = 's1'`);
  assert.equal(await count(), 1, 'ending a session deletes its tokens');
  await pool.query(`DELETE FROM users WHERE id = 'u2'`);
  assert.equal(await count(), 0, 'deleting an account deletes its tokens');

  await rollBackThrough(databaseUrl, '20261023130000_create_device_tokens');
  assert.equal(await exists(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
});
