'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');
const { runner } = require('node-pg-migrate');

const { createTestDatabase } = require('./db-harness');
const { runMigrations } = require('../src/lib/migrate');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATIONS_DIR = path.resolve(__dirname, '../src/migrations');

function step(databaseUrl, direction) {
  return runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count: 1,
    migrationsTable: 'pgmigrations',
    logger: SILENT,
    noLock: true
  });
}

async function membershipsOf(pool, roomId) {
  const result = await pool.query(
    `SELECT u.login, m.role, m.created_at, m.metadata
     FROM room_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1
     ORDER BY u.login`,
    [roomId]
  );
  return result.rows;
}

test('bookmark backfill promotes list-only users to members, skips bans and dead rooms, and rolls back only its rows', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
  t.after(async () => {
    await pool.end();
    await db.cleanup();
  });

  await step(db.databaseUrl, 'down');

  const ids = {};
  for (const login of ['owner', 'alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina']) {
    ids[login] = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, $2, $3, 'x')`,
      [ids[login], login, login]
    );
  }
  await pool.query(
    `INSERT INTO rooms (id, is_static, owner_id, deleted_at) VALUES
       ('static-room', true, $1, NULL),
       ('deleted-room', true, $1, current_timestamp),
       ('temp-room', false, NULL, NULL)`,
    [ids.owner]
  );
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, metadata) VALUES
       ($1, 'static-room', $2, 'owner', '2026-07-01T10:00:00Z', '{}'),
       ($3, 'static-room', $4, 'member', '2026-08-01T10:00:00Z', '{"joined":"voice"}')`,
    [crypto.randomUUID(), ids.owner, crypto.randomUUID(), ids.erin]
  );
  const bookmarkedAt = '2026-07-03T12:39:00.000Z';
  const bookmarks = [
    ['static-room', 'owner'], ['static-room', 'alice'], ['static-room', 'bob'], ['static-room', 'carol'],
    ['static-room', 'dave'], ['static-room', 'erin'], ['deleted-room', 'frank'], ['temp-room', 'gina']
  ];
  for (const [roomId, login] of bookmarks) {
    await pool.query(
      `INSERT INTO room_bookmarks (id, room_id, user_id, created_at) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), roomId, ids[login], bookmarkedAt]
    );
  }
  await pool.query(
    `INSERT INTO room_bans (id, room_id, user_id, expires_at, revoked_at) VALUES
       ($1, 'static-room', $2, NULL, NULL),
       ($3, 'static-room', $4, NULL, current_timestamp),
       ($5, 'static-room', $6, current_timestamp - interval '1 day', NULL)`,
    [crypto.randomUUID(), ids.bob, crypto.randomUUID(), ids.carol, crypto.randomUUID(), ids.dave]
  );

  await step(db.databaseUrl, 'up');

  const promoted = await membershipsOf(pool, 'static-room');
  assert.deepEqual(promoted.map((row) => [row.login, row.role]), [
    ['alice', 'member'], ['carol', 'member'], ['dave', 'member'], ['erin', 'member'], ['owner', 'owner']
  ]);
  const alice = promoted.find((row) => row.login === 'alice');
  assert.equal(alice.created_at.toISOString(), bookmarkedAt);
  assert.deepEqual(alice.metadata, { source: 'bookmark_backfill' });
  assert.deepEqual(promoted.find((row) => row.login === 'erin').metadata, { joined: 'voice' });
  assert.deepEqual(promoted.find((row) => row.login === 'owner').metadata, {});
  assert.deepEqual(await membershipsOf(pool, 'deleted-room'), []);
  assert.deepEqual(await membershipsOf(pool, 'temp-room'), []);

  assert.deepEqual(await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true }), []);

  await step(db.databaseUrl, 'down');
  assert.deepEqual((await membershipsOf(pool, 'static-room')).map((row) => row.login), ['erin', 'owner']);

  await step(db.databaseUrl, 'up');
  assert.deepEqual((await membershipsOf(pool, 'static-room')).map((row) => row.login), ['alice', 'carol', 'dave', 'erin', 'owner']);
});
