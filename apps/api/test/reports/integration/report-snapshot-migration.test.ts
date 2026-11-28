import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const migration = '20261127140000_snapshot_content_reports';

test('report snapshots backfill multiple batches, skip missing messages, and roll back', async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await rollBackThrough(databaseUrl, migration);
  await pool.query(`
    INSERT INTO users (id, login, password_hash) VALUES ('reporter', 'reporter', 'x'), ('sender', 'sender', 'x');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
      SELECT 'dm-' || n, 'sender', 'reporter', 'Original message', '2026-11-27T12:00:00Z'::timestamptz
      FROM generate_series(1, 501) AS n;
    INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason)
      SELECT 'reporter', 'direct_message', id, 'spam' FROM direct_messages;
    INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason)
      VALUES ('reporter', 'direct_message', 'missing', 'abuse');
    INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason, room_id)
      VALUES ('reporter', 'room_message', 'dm-1', 'spam', 'a-room');
  `);

  await runMigrations({ databaseUrl, logger: SILENT });
  const matched = await pool.query<{ snapshot: unknown }>(
    `SELECT snapshot FROM content_reports WHERE snapshot IS NOT NULL`
  );
  assert.equal(matched.rowCount, 501);
  assert.deepEqual(matched.rows[0], {
    snapshot: {
      text: 'Original message',
      senderId: 'sender',
      createdAt: '2026-11-27T12:00:00+00:00',
      attachments: []
    }
  });
  assert.equal((await pool.query('SELECT 1 FROM content_reports WHERE snapshot IS NULL')).rowCount, 2);

  // The rollback build files reports with its own insert shape, without a
  // snapshot; the report still captures the message as it was then.
  await pool.query(`
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
      VALUES ('dm-legacy', 'sender', 'reporter', 'Reported during rollback', '2026-11-28T09:00:00Z');
    INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason)
      VALUES ('reporter', 'direct_message', 'dm-legacy', 'abuse');
    UPDATE direct_messages SET body = 'Edited afterwards' WHERE id = 'dm-legacy';
  `);
  assert.deepEqual(
    (await pool.query<{ snapshot: unknown }>(`SELECT snapshot FROM content_reports WHERE message_id = 'dm-legacy'`))
      .rows,
    [
      {
        snapshot: {
          text: 'Reported during rollback',
          senderId: 'sender',
          createdAt: '2026-11-28T09:00:00+00:00',
          attachments: []
        }
      }
    ]
  );

  await rollBackThrough(databaseUrl, migration);
  await assert.rejects(pool.query('SELECT snapshot FROM content_reports'), /column "snapshot" does not exist/);
  assert.equal((await pool.query('SELECT 1 FROM content_reports')).rowCount, 504);
  assert.equal(
    (await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'content_reports_capture_dm_snapshot'`)).rowCount,
    0
  );
  // The rolled-back schema still accepts the old insert shape.
  await pool.query(`INSERT INTO content_reports (reporter_user_id, target_kind, message_id, reason)
    VALUES ('reporter', 'direct_message', 'after-rollback', 'abuse')`);
});
