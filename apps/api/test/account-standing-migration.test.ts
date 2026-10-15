// An account's block, its mark and the administrators' log: a block needs its
// start, a mark is one of the known ones, and a rollback removes them again.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('account standing columns and the admin log migrate and roll back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const present = async () => {
    const { rows } = await pool.query<{ log: string | null; columns: string }>(
      `SELECT to_regclass('public.admin_actions') AS log,
         (SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name IN ('blocked_at', 'blocked_until', 'block_reason', 'badge')) AS columns`
    );
    return { log: rows[0]?.log != null, columns: Number(rows[0]?.columns) };
  };

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.deepEqual(await present(), { log: true, columns: 4 });
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);
  await assert.rejects(pool.query(`UPDATE users SET blocked_until = now()`), /users_block_check/);
  await assert.rejects(pool.query(`UPDATE users SET badge = 'gold'`), /users_badge_check/);
  await pool.query(`UPDATE users SET blocked_at = now(), blocked_until = NULL, badge = 'official'`);
  await assert.rejects(
    pool.query(`INSERT INTO admin_actions (admin_user_id, target_user_id, action) VALUES ('a', 'u1', 'ban')`),
    /admin_actions_action_check/
  );
  await pool.query(`INSERT INTO admin_actions (admin_user_id, target_user_id, action) VALUES ('a', 'u1', 'block')`);

  await rollBackThrough(databaseUrl, '20261017120000_create_account_standing');
  assert.deepEqual(await present(), { log: false, columns: 0 });

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.deepEqual(await present(), { log: true, columns: 4 });
});
