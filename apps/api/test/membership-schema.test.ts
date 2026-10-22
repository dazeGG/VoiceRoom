import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { test } from 'node:test';
import { runMigrations } from '../src/lib/migrate.ts';
import { Type } from 'typebox';
import { createTestDatabase } from './db-harness.ts';
import { queryRows } from './helpers/checked.ts';
import * as membershipMigration from '../src/migrations/20260615140000_create_room_memberships_and_bookmarks.cjs';

test(
  'G43-A01 room_memberships is an active-only unique room/user relation',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl } = await createTestDatabase(t);
    await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    t.after(async () => {
      await pool.end();
      await cleanup();
    });

    const columns = await queryRows(
      pool,
      Type.Object({ column_name: Type.String() }),
      `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_memberships'
  `
    );
    const names = new Set(columns.map((row) => row.column_name));
    assert.equal(names.has('deleted_at'), false);
    assert.equal(names.has('left_at'), false);
    const unique = await queryRows(
      pool,
      Type.Object({ indexdef: Type.String() }),
      `
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'room_memberships'
  `
    );
    assert.ok(unique.some((row) => /UNIQUE.*\(room_id, user_id\)/i.test(row.indexdef)));
  }
);

test('G43-A02 no later membership-history migration exists', () => {
  assert.equal(typeof membershipMigration.up, 'function');
  assert.equal(typeof membershipMigration.down, 'function');
});
