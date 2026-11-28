// The official account and support migrations, both ways: down removes the
// account only while no direct message involves it (rows elsewhere that point
// at it go with it), drops the support tables and the support entries of the
// action log, and up runs again cleanly. Up stops with a clear message when an
// older account holds the login.

import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const quiet = { log() {}, info() {}, warn() {}, error() {} };
const OFFICIAL_MIGRATION = '20261128120000_create_official_account';
const SUPPORT_MIGRATION = '20261128121000_create_support';

async function tableExists(
  pool: { query(sql: string, values: unknown[]): Promise<{ rowCount: number | null }> },
  name: string
) {
  return (await pool.query('SELECT 1 FROM pg_tables WHERE tablename = $1', [name])).rowCount === 1;
}

test('without conversations, down removes the official account and the support tables; up restores them', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'alice', 'Alice', 'x')`);
  await pool.query(`INSERT INTO support_threads (user_id) VALUES ('a')`);
  await pool.query(`INSERT INTO support_notes (user_id, author_id, body) VALUES ('a', 'a', 'note')`);
  await pool.query(
    `INSERT INTO admin_actions (admin_user_id, target_user_id, action) VALUES ('a', 'a', 'support_note'), ('a', 'a', 'block')`
  );
  await rollBackThrough(databaseUrl, SUPPORT_MIGRATION);
  for (const table of ['support_threads', 'support_notes', 'support_replies'])
    assert.equal(await tableExists(pool, table), false, table);
  assert.deepEqual((await pool.query<{ action: string }>('SELECT action FROM admin_actions')).rows, [
    { action: 'block' }
  ]);
  await assert.rejects(
    pool.query(`INSERT INTO admin_actions (admin_user_id, target_user_id, action) VALUES ('a', 'a', 'support_reply')`),
    { code: '23514' }
  );
  await rollBackThrough(databaseUrl, OFFICIAL_MIGRATION);
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount, 0);

  await runMigrations({ databaseUrl, logger: quiet });
  assert.equal(
    (await pool.query(`SELECT 1 FROM users WHERE id = $1 AND badge = 'official'`, [OFFICIAL_ACCOUNT_ID])).rowCount,
    1
  );
  assert.equal(await tableExists(pool, 'support_threads'), true);
  await pool.query(
    `INSERT INTO admin_actions (admin_user_id, target_user_id, action) VALUES ('a', 'a', 'support_reply')`
  );
});

test('with a conversation, down keeps the official account and its messages; up again is a no-op for it', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'alice', 'Alice', 'x')`);
  await pool.query(`INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('m1', 'a', $1, 'Привет')`, [
    OFFICIAL_ACCOUNT_ID
  ]);
  await pool.query(`INSERT INTO support_threads (user_id, last_user_message_at) VALUES ('a', now())`);
  await pool.query(`INSERT INTO support_replies (message_id, staff_id) VALUES ('m1', 'a')`);
  // A resolved thread needs its time; an open one must not carry it.
  await assert.rejects(pool.query(`UPDATE support_threads SET status = 'resolved'`), { code: '23514' });
  await rollBackThrough(databaseUrl, OFFICIAL_MIGRATION);
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM direct_messages')).rowCount, 1);
  await runMigrations({ databaseUrl, logger: quiet });
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount, 1);
  // A deleted message takes its staff attribution with it.
  await pool.query(`INSERT INTO support_replies (message_id, staff_id) VALUES ('m1', 'a')`);
  await pool.query(`DELETE FROM direct_messages`);
  assert.equal((await pool.query('SELECT 1 FROM support_replies')).rowCount, 0);
  // The thread goes with the person's account.
  await pool.query(`INSERT INTO support_threads (user_id) VALUES ('a')`);
  await pool.query(`DELETE FROM users WHERE id = 'a'`);
  assert.equal((await pool.query('SELECT 1 FROM support_threads')).rowCount, 0);
});

test('down removes the official account with the rows that point at it, and keeps the people', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'alice', 'Alice', 'x')`);
  const [low, high] = ['a', OFFICIAL_ACCOUNT_ID].sort();
  // Alice lets VoiceRoom write to her and muted it; a pair state outlived its messages.
  await pool.query(`INSERT INTO contact_allow_list (owner_id, allowed_id, kind) VALUES ('a', $1, 'messages')`, [
    OFFICIAL_ACCOUNT_ID
  ]);
  await pool.query(
    `INSERT INTO dm_pair_state (user_low, user_high, initiator_id, last_sender_id, first_message_at, unanswered_count)
      VALUES ($1, $2, 'a', 'a', now(), 1)`,
    [low, high]
  );
  await pool.query(`INSERT INTO notification_dm_mutes (id, user_id, peer_user_id) VALUES ('mute-1', 'a', $1)`, [
    OFFICIAL_ACCOUNT_ID
  ]);
  await rollBackThrough(databaseUrl, OFFICIAL_MIGRATION);
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount, 0);
  for (const table of ['contact_allow_list', 'dm_pair_state', 'notification_dm_mutes'])
    assert.equal((await pool.query(`SELECT 1 FROM ${table}`)).rowCount, 0, table);
  assert.equal((await pool.query(`SELECT 1 FROM users WHERE id = 'a'`)).rowCount, 1);
  await runMigrations({ databaseUrl, logger: quiet });
});

test('up stops with the conflicting account named when an older account holds the login', async (t) => {
  const { databaseUrl, pool } = await createTestDatabase(t);
  await rollBackThrough(databaseUrl, OFFICIAL_MIGRATION);
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('older', 'voiceroom', 'Old', 'x')`
  );
  await assert.rejects(runMigrations({ databaseUrl, logger: quiet }), /login voiceroom is taken by account older/);
  assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount, 0);
  assert.equal((await pool.query(`SELECT 1 FROM users WHERE id = 'older' AND login = 'voiceroom'`)).rowCount, 1);
});
