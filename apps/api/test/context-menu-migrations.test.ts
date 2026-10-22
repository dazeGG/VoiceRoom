import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';

import { Type } from 'typebox';
import { createTestDatabase } from './db-harness.ts';
import { AnyRow, queryRows } from './helpers/checked.ts';
import { rollBackThrough } from './migration-steps.ts';
import { runMigrations } from '../src/lib/migrate.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const NEW_TABLES = ['room_message_pins', 'user_blocks', 'room_server_mutes'];
const FIRST_CONTEXT_MENU_MIGRATION = '20260809120000_create_room_message_pins.cjs';

test('context-menu migrations apply fresh, no-op at head, roll back, and reapply', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t, { empty: true });
  const client = new Client({ connectionString: databaseUrl });
  t.after(async () => {
    await client.end().catch(() => {});
    await cleanup();
  });

  const applied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.ok(applied.length > 0);
  await client.connect();
  const fresh = await queryRows(
    client,
    Type.Object({ table_name: Type.String() }),
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [NEW_TABLES]
  );
  assert.deepEqual(
    fresh.map((row) => row.table_name),
    [...NEW_TABLES].sort()
  );

  assert.deepEqual(await runMigrations({ databaseUrl, logger: SILENT }), []);

  const rollbackCount = await rollBackThrough(databaseUrl, FIRST_CONTEXT_MENU_MIGRATION);
  const absent = await queryRows(
    client,
    AnyRow,
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [NEW_TABLES]
  );
  assert.deepEqual(absent, []);

  const reapplied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(reapplied.length, rollbackCount);
});
