'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModerationRepository } = require('../src/domains/moderation/moderation-repository');
const { createModerationService } = require('../src/domains/moderation/moderation-service');

test('G86-A01 unauthorized ban requests do not resolve target principals', async () => {
  let resolutions = 0;
  const repository = { async isRoomOwner() { return false; } };
  const service = createModerationService({
    pool: { connect() { throw new Error('transaction must not start'); } },
    repository,
    async resolvePrincipals() { resolutions += 1; return []; }
  });
  const result = await service.putBan({
    roomId: 'room', actorUserId: 'intruder', idempotencyKey: 'request-1',
    input: { userId: 'target', duration: '1h', reason: 'private owner note' }
  });
  assert.equal(result.status, 'forbidden');
  assert.equal(resolutions, 0);
});

test('G86-A02 active-list cursor preserves PostgreSQL microseconds', async () => {
  let encoded;
  const cursorCodec = {
    encode(value) { encoded = value; return 'cursor'; },
    decode() { return null; }
  };
  const pool = {
    async query(sql) {
      assert.match(sql, /EXTRACT\(EPOCH FROM created_at\).*1000000/);
      return { rows: [
        { id: 'b', room_id: 'room', created_at: new Date(0), created_at_micros: '1234567' },
        { id: 'a', room_id: 'room', created_at: new Date(0), created_at_micros: '1234566' }
      ] };
    }
  };
  const page = await createModerationRepository({ cursorCodec, pool }).listActive({ roomId: 'room', limit: 1 });
  assert.equal(page.nextCursor, 'cursor');
  assert.equal(encoded.tuple.createdAtMicros, '1234567');
  assert.equal(encoded.tuple.id, 'b');
});

test('G86-A03 public ban projection never exposes guest IP', () => {
  const repository = createModerationRepository({
    cursorCodec: { encode() {}, decode() {} }, pool: { async query() { return { rows: [] }; } }
  });
  const projected = repository.mapModerationBan({ id: 'ban', room_id: 'room', ip: '203.0.113.9', created_at: new Date(0) });
  assert.deepEqual(projected.subject, { kind: 'guest', userId: null });
  assert.equal(JSON.stringify(projected).includes('203.0.113.9'), false);
});
