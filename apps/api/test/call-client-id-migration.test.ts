import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('client-id migration backfills kept guest history, indexes it and rolls back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await rollBackThrough(databaseUrl, '20261114120000_keep_call_client_id');
  const guestId = 'a1111111-1111-4111-8111-111111111111';
  await pool.query(
    `INSERT INTO voice_sessions (room_id, guest_id, joined_at, left_at)
    VALUES ('kept', $1, now(), now()), (NULL, $1, now(), now()), ('account', NULL, now(), now())`,
    [guestId]
  );
  await runMigrations({ databaseUrl, logger: SILENT });
  const rows = await pool.query<{ room_id: string | null; client_id: string | null }>(
    'SELECT room_id, client_id FROM voice_sessions ORDER BY room_id NULLS LAST'
  );
  assert.deepEqual(rows.rows, [
    { room_id: 'account', client_id: null },
    { room_id: 'kept', client_id: guestId },
    { room_id: null, client_id: null }
  ]);
  const index = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'voice_sessions_client_id_idx'`
  );
  assert.match(index.rows[0]?.indexdef ?? '', /client_id, joined_at/);
  assert.match(index.rows[0]?.indexdef ?? '', /WHERE \(client_id IS NOT NULL\)/);
  await rollBackThrough(databaseUrl, '20261114120000_keep_call_client_id');
  const column = await pool.query<{ present: number }>(
    `SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'voice_sessions' AND column_name = 'client_id'`
  );
  assert.equal(column.rowCount, 0);
  await runMigrations({ databaseUrl, logger: SILENT });
});
