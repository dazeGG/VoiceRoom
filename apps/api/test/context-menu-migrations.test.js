'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { createTestDatabase } = require('./db-harness');
const { runMigrations } = require('../src/lib/migrate');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const NEW_TABLES = ['room_message_pins', 'user_blocks', 'room_server_mutes'];
const FIRST_CONTEXT_MENU_MIGRATION = '20260809120000_create_room_message_pins.js';

// Down migrations run from the head, so reaching the context-menu tables also
// undoes every migration added after them.
function rollbackCountThrough(fileName) {
  const files = fs.readdirSync(path.resolve(__dirname, '../src/migrations'))
    .filter((name) => name.endsWith('.js'))
    .sort();
  assert.ok(files.includes(fileName), `${fileName} is missing`);
  return files.length - files.indexOf(fileName);
}

test('context-menu migrations apply fresh, no-op at head, roll back, and reapply', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const client = new Client({ connectionString: databaseUrl });
  t.after(async () => {
    await client.end().catch(() => {});
    await cleanup();
  });

  const applied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.ok(applied.length > 0);
  await client.connect();
  const fresh = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [NEW_TABLES]
  );
  assert.deepEqual(fresh.rows.map((row) => row.table_name), [...NEW_TABLES].sort());

  assert.deepEqual(await runMigrations({ databaseUrl, logger: SILENT }), []);

  const rollbackCount = rollbackCountThrough(FIRST_CONTEXT_MENU_MIGRATION);
  for (let index = 0; index < rollbackCount; index += 1) {
    const rolledBack = await runMigrations({ databaseUrl, direction: 'down', logger: SILENT });
    assert.equal(rolledBack.length, 1);
  }
  const absent = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [NEW_TABLES]
  );
  assert.deepEqual(absent.rows, []);

  const reapplied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(reapplied.length, rollbackCount);
});
