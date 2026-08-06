'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createActiveBanRepository, normalizePrincipal } = require('../src/domains/moderation/active-ban-repository');
const { createActiveBanService } = require('../src/domains/moderation/active-ban-service');

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
