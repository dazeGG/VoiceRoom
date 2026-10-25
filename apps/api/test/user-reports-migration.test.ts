import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test(
  'user report migration dedupes open targets and rollback preserves legacy message reports',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    t.after(db.cleanup);
    await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT });
    await db.pool.query(
      `INSERT INTO users (id, login, password_hash) VALUES ('reporter', 'alice', 'x'), ('target', 'bob', 'x')`
    );
    await db.pool.query(
      `INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason) VALUES ('reporter', 'direct_message', 'm1', 'spam')`
    );
    const file = (target = 'target') =>
      db.pool.query(
        `INSERT INTO user_reports (reporter_user_id, target_user_id, reason) VALUES ('reporter', $1, 'abuse')`,
        [target]
      );
    await file();
    await assert.rejects(file(), /user_reports_open_unique_idx/);
    await assert.rejects(file('reporter'), /user_reports_not_self_check/);
    await assert.rejects(db.pool.query(`UPDATE user_reports SET status = 'actioned'`), /user_reports_status_check/);
    await db.pool.query(`UPDATE user_reports SET status = 'dismissed', resolved_at = now()`);
    await file();
    await rollBackThrough(db.databaseUrl, '20261025120000_create_user_reports');
    assert.equal(
      (await db.pool.query<{ name: string | null }>(`SELECT to_regclass('public.user_reports') AS name`)).rows[0]?.name,
      null
    );
    assert.equal((await db.pool.query(`SELECT * FROM content_reports WHERE message_id = 'm1'`)).rowCount, 1);
    await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT });
    await file();
    await db.pool.query(`DELETE FROM users WHERE id = 'target'`);
    assert.equal((await db.pool.query(`SELECT id FROM user_reports`)).rowCount, 1, 'target deletion preserves review');
    await db.pool.query(`DELETE FROM users WHERE id = 'reporter'`);
    assert.equal(
      (await db.pool.query(`SELECT id FROM user_reports`)).rowCount,
      0,
      'reporter deletion follows existing report retention semantics'
    );
  }
);
