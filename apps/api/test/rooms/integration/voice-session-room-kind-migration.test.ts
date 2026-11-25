// A stay keeps the kind of its room from this migration on; the stays before
// have none, the column takes only the two kinds, and the rollback drops it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const MIGRATION = '20261119120000_keep_voice_session_room_kind';

test('the room kind of a stay migrates forward empty, holds two kinds and rolls back', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await rollBackThrough(databaseUrl, MIGRATION);
  await pool.query(`INSERT INTO voice_sessions (room_id, joined_at, left_at) VALUES ('before', now(), now())`);

  await runMigrations({ databaseUrl, logger: SILENT });
  const kept = await pool.query<{ room_kind: string | null }>(
    `SELECT room_kind FROM voice_sessions WHERE room_id = 'before'`
  );
  assert.deepEqual(kept.rows, [{ room_kind: null }]);
  await pool.query(
    `INSERT INTO voice_sessions (room_id, room_kind, joined_at, left_at)
     VALUES ('app', 'main', now(), now()), ('site', 'widget', now(), now())`
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO voice_sessions (room_id, room_kind, joined_at, left_at) VALUES ('x', 'embed', now(), now())`
    ),
    /voice_sessions_room_kind_check/
  );

  await rollBackThrough(databaseUrl, MIGRATION);
  const column = await pool.query<{ present: number }>(
    `SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'voice_sessions' AND column_name = 'room_kind'`
  );
  assert.equal(column.rowCount, 0);
  const rows = await pool.query<{ room_id: string }>(`SELECT room_id FROM voice_sessions ORDER BY room_id`);
  assert.deepEqual(
    rows.rows.map((row) => row.room_id),
    ['app', 'before', 'site'],
    'the stays outlive the rollback'
  );
  await runMigrations({ databaseUrl, logger: SILENT });
});
