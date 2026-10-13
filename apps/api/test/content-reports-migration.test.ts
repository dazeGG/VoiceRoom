// The reports table keeps one open report per account and message, and a
// rollback removes it again.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('content_reports allows one open report per message and account, and rolls back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const exists = async () => {
    const { rows } = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.content_reports') AS name`);
    return rows[0]?.name != null;
  };

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);
  const file = (kind = 'direct_message', roomId: string | null = null) =>
    pool.query(
      `INSERT INTO content_reports (reporter_user_id, target_kind, room_id, message_id, reason)
       VALUES ('u1', $1, $2, 'm1', 'spam')`,
      [kind, roomId]
    );
  await file();
  await assert.rejects(file(), /content_reports_open_unique_idx/);
  await assert.rejects(file('room_message', null), /content_reports_target_check/);
  await pool.query(`UPDATE content_reports SET status = 'dismissed', resolved_at = now()`);
  await file();
  await assert.rejects(
    pool.query(`UPDATE content_reports SET status = 'actioned' WHERE resolved_at IS NULL`),
    /content_reports_status_check/
  );

  await rollBackThrough(databaseUrl, '20261013120000_create_content_reports');
  assert.equal(await exists(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
});
