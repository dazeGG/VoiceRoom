'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Pool } = require('pg');
const test = require('node:test');
const { runMigrations } = require('../src/lib/migrate');
const { createReactionRepository } = require('../src/domains/messaging/reaction-repository');
const { createTestDatabase } = require('./db-harness');

async function fixture(t) {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 12 });
  t.after(async () => { await pool.end(); await db.cleanup(); });
  await pool.query(`
    INSERT INTO users(id, login, display_name, password_hash)
    VALUES ('actor', 'actor-reactions', 'Actor', 'x'), ('peer', 'peer-reactions', 'Peer', 'x');
    INSERT INTO rooms(id, creator_ip) VALUES ('reaction-room', '');
    INSERT INTO room_messages(id, room_id, text) VALUES ('reaction-message', 'reaction-room', 'hello');
  `);
  return { pool, repository: createReactionRepository({ client: pool }) };
}

test('G68-A01 desired-state rows are unique, idempotent, monotonic and application-rollback safe', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const { pool, repository } = await fixture(t);
  const set = (active, userId = 'actor') => repository.transaction((client) => repository.setDesiredState({
    type: 'room', messageId: 'reaction-message', emoji: '😀', userId, active, client
  }));
  const first = await set(true);
  const duplicate = await set(true);
  assert.deepEqual([first.changed, duplicate.changed], [true, false]);
  assert.equal(first.revision, duplicate.revision);

  await Promise.all(Array.from({ length: 20 }, (_, index) => set(index % 2 === 0)));
  const state = await pool.query(`SELECT count(*)::int AS count FROM room_message_reactions WHERE message_id = 'reaction-message' AND emoji = '😀' AND user_id = 'actor'`);
  const revision = await pool.query(`SELECT revision FROM room_message_reaction_revisions WHERE message_id = 'reaction-message' AND emoji = '😀'`);
  assert.ok(state.rows[0].count === 0 || state.rows[0].count === 1);
  assert.ok(BigInt(revision.rows[0].revision) >= 1n);

  await assert.rejects(repository.transaction(async (client) => {
    await repository.setDesiredState({ type: 'room', messageId: 'reaction-message', emoji: '👩🏽‍💻', userId: 'actor', active: true, client });
    throw new Error('rollback');
  }), /rollback/);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM room_message_reactions WHERE emoji = '👩🏽‍💻'`)).rows[0].count, 0);
  const migration = fs.readFileSync(require.resolve('../src/migrations/20260718135000_create_message_reactions.js'), 'utf8');
  assert.match(migration, /lock_timeout = '5s'/);
});

test('G68-A02 same-microsecond 10k reactor pagination is stable and index-backed', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const { pool, repository } = await fixture(t);
  await pool.query(`
    INSERT INTO users(id, login, display_name, password_hash)
    SELECT 'reactor-' || lpad(gs::text, 20, '0'), 'reactor-login-' || gs, 'Reactor ' || gs, 'x'
    FROM generate_series(1, 10000) gs;
    INSERT INTO room_message_reaction_revisions(message_id, emoji, revision)
    VALUES ('reaction-message', '😀', 10000)
    ON CONFLICT (message_id, emoji) DO UPDATE SET revision = EXCLUDED.revision;
    INSERT INTO room_message_reactions(message_id, emoji, user_id, revision, created_at)
    SELECT 'reaction-message', '😀', 'reactor-' || lpad(gs::text, 20, '0'), gs, '2026-08-06T10:00:00.123456Z'::timestamptz
    FROM generate_series(1, 10000) gs;
  `);
  const seen = new Set();
  let after = null;
  while (seen.size < 10000) {
    const page = await repository.listReactors({ type: 'room', messageId: 'reaction-message', emoji: '😀', limit: 100, after });
    assert.ok(page.length > 0);
    for (const reactor of page) {
      assert.equal(seen.has(reactor.userId), false);
      seen.add(reactor.userId);
    }
    after = page.at(-1).cursorTuple;
  }
  assert.equal(seen.size, 10000);
  const indexes = (await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'room_message_reactions'`)).rows.map((row) => row.indexdef).join('\n');
  assert.match(indexes, /message_id, emoji, created_at, user_id/);
});
