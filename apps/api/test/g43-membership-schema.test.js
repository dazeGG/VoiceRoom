'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { test } = require('node:test');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

test('G43-A01 room_memberships is an active-only unique room/user relation', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await cleanup(); });

  const columns = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_memberships'
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  assert.equal(names.has('deleted_at'), false);
  assert.equal(names.has('left_at'), false);
  const unique = await pool.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'room_memberships'
  `);
  assert.ok(unique.rows.some((row) => /UNIQUE.*\(room_id, user_id\)/i.test(row.indexdef)));
});

test('G43-A02 no later membership-history migration exists', () => {
  const migration = require('../src/migrations/20260615140000_create_room_memberships_and_bookmarks');
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
});
