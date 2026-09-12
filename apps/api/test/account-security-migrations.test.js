'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const { runMigrations } = require('../src/lib/migrate');
const { createUserStore } = require('../src/lib/user-store');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATIONS_DIR = path.join(__dirname, '../src/migrations');
const FIRST_ACCOUNT_SECURITY_MIGRATION = '20260912120000_add_session_device_metadata';

function rollbackCountThrough(name) {
  const names = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.replace(/\.js$/, ''))
    .sort();
  const index = names.indexOf(name);
  assert.notEqual(index, -1, `${name} is missing from the migrations directory`);
  return names.length - index;
}

async function sessionColumns(pool) {
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions' ORDER BY column_name`
  );
  return result.rows.map((row) => row.column_name);
}

async function recoveryTableExists(pool) {
  const result = await pool.query(`SELECT to_regclass('public.account_recovery_codes') AS name`);
  return result.rows[0].name !== null;
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
  const backfilled = await pool.query(`SELECT public_id, user_agent, location_label FROM sessions WHERE user_id = $1`, [user.id]);
  assert.equal(backfilled.rowCount, 1);
  assert.match(backfilled.rows[0].public_id, /^[0-9a-f-]{36}$/);
  assert.equal(backfilled.rows[0].user_agent, '');
  assert.equal(backfilled.rows[0].location_label, '');
});
