// Nothing writes capability heartbeats any more, so the table is dropped; a
// rollback recreates it for an API from before the readiness removal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('the heartbeat table is dropped, and a rollback brings it back with its key', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const exists = async () => {
    const { rows } = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.capability_runtime_heartbeats') AS name`
    );
    return rows[0]?.name != null;
  };

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), false);

  await rollBackThrough(databaseUrl, '20260929160000_drop_capability_runtime_heartbeats');
  assert.equal(await exists(), true);
  await pool.query(`INSERT INTO capability_runtime_heartbeats (runtime_kind, runtime_id) VALUES ('api', 'api-1')`);
  await assert.rejects(
    pool.query(`INSERT INTO capability_runtime_heartbeats (runtime_kind, runtime_id) VALUES ('api', 'api-1')`),
    /duplicate key/
  );

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), false);
});
