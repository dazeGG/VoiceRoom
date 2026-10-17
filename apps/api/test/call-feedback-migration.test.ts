// The call feedback table checks its rating, platform and comment length,
// keeps an answer when its account goes or its author is forgotten, and a
// rollback removes it again.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCallFeedbackRepository } from '../src/domains/feedback/call-feedback.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('call_feedback checks its values, outlives its account, and rolls back cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const exists = async () => {
    const { rows } = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.call_feedback') AS name`);
    return rows[0]?.name != null;
  };

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);
  const answer = (rating = 'good', platform = 'browser', comment = '') =>
    pool.query(
      `INSERT INTO call_feedback (user_id, rating, room_id, duration_s, peers, platform, comment)
       VALUES ('u1', $1, 'r1', 90, 1, $2, $3)`,
      [rating, platform, comment]
    );
  await answer();
  await assert.rejects(answer('meh'), /call_feedback_rating_check/);
  await assert.rejects(answer('bad', 'fridge'), /call_feedback_platform_check/);
  await assert.rejects(answer('bad', 'browser', 'x'.repeat(1001)), /call_feedback_comment_check/);

  await pool.query(`DELETE FROM users WHERE id = 'u1'`);
  const { rows } = await pool.query<{ user_id: string | null; tags: string[] }>(
    'SELECT user_id, tags FROM call_feedback'
  );
  assert.deepEqual(rows, [{ user_id: null, tags: [] }]);

  await rollBackThrough(databaseUrl, '20261020120000_create_call_feedback');
  assert.equal(await exists(), false);

  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(await exists(), true);
});

test('an answer stops saying whose it was once it is older than the voice history', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('u1', 'ada', 'x')`);
  const cutoff = new Date('2026-07-01T00:00:00Z');
  await pool.query(
    `INSERT INTO call_feedback (user_id, rating, room_id, duration_s, peers, platform, comment, created_at)
     VALUES ('u1', 'bad', 'r1', 90, 1, 'browser', 'old', $1), ('u1', 'good', 'r1', 90, 1, 'browser', 'new', $2)`,
    [new Date(cutoff.getTime() - 1000), new Date(cutoff.getTime() + 1000)]
  );

  const repository = createCallFeedbackRepository({ pool });
  assert.equal(await repository.forgetAuthorsBefore(cutoff), 1);
  const { rows } = await pool.query<{ comment: string; user_id: string | null; room_id: string }>(
    'SELECT comment, user_id, room_id FROM call_feedback ORDER BY created_at'
  );
  assert.deepEqual(rows, [
    { comment: 'old', user_id: null, room_id: 'r1' },
    { comment: 'new', user_id: 'u1', room_id: 'r1' }
  ]);
  assert.equal(await repository.forgetAuthorsBefore(cutoff), 0, 'a second sweep has nothing left to forget');
});
