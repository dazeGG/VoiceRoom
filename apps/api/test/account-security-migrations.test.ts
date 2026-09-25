import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

import { runMigrations } from '../src/lib/migrate.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATIONS_DIR = path.join(import.meta.dirname, '../src/migrations');
const FIRST_ACCOUNT_SECURITY_MIGRATION = '20260912120000_add_session_device_metadata';

function rollbackCountThrough(name: string) {
  const names = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.cjs'))
    .map((file) => file.replace(/\.c?js$/, ''))
    .sort();
  const index = names.indexOf(name);
  assert.notEqual(index, -1, `${name} is missing from the migrations directory`);
  return names.length - index;
}

async function sessionColumns(pool: Pool) {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions' ORDER BY column_name`
  );
  return result.rows.map((row) => row.column_name);
}

async function recoveryTableExists(pool: Pool) {
  const result = await pool.query<{ name: string | null }>(
    `SELECT to_regclass('public.account_recovery_codes') AS name`
  );
  return result.rows[0]?.name != null;
}

test('account security migrations apply, roll back cleanly and backfill existing sessions on reapply', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createUserStore({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await store.close();
    await pool.end();
    await cleanup();
  });

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.ok((await sessionColumns(pool)).includes('public_id'));
  assert.ok(await recoveryTableExists(pool));

  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);

  const rollbackCount = rollbackCountThrough(FIRST_ACCOUNT_SECURITY_MIGRATION);
  for (let index = 0; index < rollbackCount; index += 1) {
    const rolledBack = await runMigrations({ databaseUrl, direction: 'down', logger: SILENT });
    assert.equal(rolledBack.length, 1);
  }
  const columns = await sessionColumns(pool);
  for (const column of ['public_id', 'user_agent', 'location_label']) {
    assert.equal(columns.includes(column), false, `${column} must be dropped on rollback`);
  }
  assert.equal(await recoveryTableExists(pool), false);

  // A session written by the previous release must get an id on upgrade.
  await pool.query(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, now(), now(), now() + interval '1 day')`,
    [crypto.randomBytes(16).toString('hex'), user.id]
  );

  const reapplied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(reapplied.length, rollbackCount);
  const backfilled = await pool.query(`SELECT public_id, user_agent, location_label FROM sessions WHERE user_id = $1`, [
    user.id
  ]);
  assert.equal(backfilled.rowCount, 1);
  assert.match(backfilled.rows[0].public_id, /^[0-9a-f-]{36}$/);
  assert.equal(backfilled.rows[0].user_agent, '');
  assert.equal(backfilled.rows[0].location_label, '');
});
