'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { test } = require('node:test');
const { createActiveBanRepository, normalizePrincipal } = require('../src/domains/moderation/active-ban-repository');
const { createActiveBanService } = require('../src/domains/moderation/active-ban-service');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

test('G41-A01 active-ban repository applies one expiry and revocation predicate', async () => {
  const queries = [];
  const pool = {
    async query(text, values) {
      queries.push({ text, values });
      if (/COUNT/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  const now = 1_725_000_000_000;
  const repository = createActiveBanRepository({ pool, now: () => now });
  assert.equal(await repository.findActive({ roomId: 'room', userId: 'user' }), null);
  assert.equal(await repository.countActive('room'), 0);
  assert.deepEqual(await repository.filterActiveUserIds({ roomId: 'room', userIds: ['user', 'user', 'other'] }), []);

  for (const query of queries) {
    assert.match(query.text, /revoked_at IS NULL/);
    assert.match(query.text, /expires_at IS NULL OR expires_at >/);
    assert.ok(query.values.some((value) => value instanceof Date && value.getTime() === now));
  }
  assert.deepEqual(normalizePrincipal({ userId: 'user', ip: '203.0.113.7' }), { userId: 'user', ip: '' });
  assert.deepEqual(normalizePrincipal({ ip: '203.0.113.7' }), { userId: null, ip: '203.0.113.7' });
});

test('G41-A01 eligibility filtering uses the same repository predicate for all user paths', async () => {
  const calls = [];
  const repository = {
    async filterActiveUserIds(input) {
      calls.push(input);
      return ['banned'];
    }
  };
  const service = createActiveBanService({ pool: {}, repository, now: () => 42 });
  assert.deepEqual(await service.filterEligibleUserIds({
    roomId: 'room',
    userIds: ['allowed', 'banned', 'allowed']
  }), ['allowed']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].userIds, ['allowed', 'banned']);
  assert.equal(calls[0].at, 42);
});

test('G41-A02 named HTTP, media, membership, mention and room-store paths call the active-ban service', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  const roomStore = fs.readFileSync(path.join(root, 'src/lib/room-store.js'), 'utf8');
  const mentions = fs.readFileSync(path.join(root, 'src/domains/notifications/mention-eligibility-service.js'), 'utf8');

  assert.match(server, /function findRoomBan[\s\S]*getActiveBanService\(\)/);
  assert.match(server, /authorizeRoomAttachment[\s\S]*getActiveBanService\(\)\.isBanned/);
  assert.match(server, /createMembershipService\([\s\S]*findRoomBan/);
  assert.doesNotMatch(server, /authorizeRoomAttachment[\s\S]*?FROM room_bans/);
  assert.match(mentions, /activeBanService\.filterEligibleUserIds/g);
  assert.doesNotMatch(mentions, /FROM room_bans/);
  assert.match(roomStore, /findActiveRoomBan[\s\S]*getActiveBanService\(\)\.getActiveBan/);
  assert.doesNotMatch(roomStore, /SELECT COUNT\(\*\)::int AS count FROM room_bans/);
});

test('G41-A02 exact expiry unblocks and one hundred expired rows consume zero active cap in PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await cleanup(); });
  const now = Date.parse('2026-08-06T12:00:00.000Z');
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('g41-user', 'g41user', 'G41 User', 'fixture')`);
  await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('g41-room', '')`);
  await pool.query(`
    INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata)
    SELECT 'g41-expired-' || value, 'g41-room', 'g41-user', '', $1::timestamptz - interval '2 seconds', $1::timestamptz - interval '1 second', '{}'::jsonb
    FROM generate_series(1, 100) AS value
  `, [new Date(now)]);
  const service = createActiveBanService({ pool, now: () => now });
  assert.equal(await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user' }), null);
  const created = await service.createBan({ roomId: 'g41-room', userId: 'g41-user', expiresAt: now + 1_000, maxActiveBans: 1 });
  assert.equal(created.status, 'created');
  assert.equal((await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user' }))?.id, created.ban.id);
  assert.equal(await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user', at: now + 1_000 }), null);
});
