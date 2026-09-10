'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCursorCodec } = require('../src/platform/cursor-codec');
const { createMessageReadService } = require('../src/domains/messaging/message-read-service');

test('G30-A01 room read uses an exact purpose-bound tuple and reports monotonic no-op', async () => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  const cursor = codec.encode({ purpose: 'room-read', context: 'room:r', tuple: { createdAtMicros: '9', id: 'm9' } });
  let tuple;
  const service = createMessageReadService({
    authorizeRoomRead: async () => true,
    cursorCodec: codec,
    repository: { advanceRoom: async (input) => { tuple = input.tuple; return { unchanged: true }; } }
  });
  // readThrough tells the caller how far the read reached, so it can retire
  // that room's notifications up to there; a no-op reached nowhere new.
  assert.deepEqual(await service.advanceRoom({ roomId: 'r', userId: 'u', cursor }), { advanced: false, cursor, readThrough: null });
  assert.deepEqual(tuple, { createdAtMicros: '9', id: 'm9' });
});

test('G30-A01b an advancing room read reports the instant it read through', async () => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  const cursor = codec.encode({ purpose: 'room-read', context: 'room:r', tuple: { createdAtMicros: '9', id: 'm9' } });
  const readAt = new Date('2026-09-10T13:38:03.617Z');
  const service = createMessageReadService({
    authorizeRoomRead: async () => true,
    cursorCodec: codec,
    repository: { advanceRoom: async () => ({ last_read_message_created_at: readAt, last_read_message_id: 'm9' }) }
  });
  assert.deepEqual(await service.advanceRoom({ roomId: 'r', userId: 'u', cursor }), { advanced: true, cursor, readThrough: readAt });
});

test('G30-A02 wrong-purpose and forbidden room reads fail before mutation', async () => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  let writes = 0;
  const service = createMessageReadService({ authorizeRoomRead: async () => false, cursorCodec: codec, repository: { advanceRoom: async () => { writes += 1; } } });
  await assert.rejects(service.advanceRoom({ roomId: 'r', userId: 'u', cursor: 'opaque' }), { code: 'room_forbidden', statusCode: 403 });
  assert.equal(writes, 0);
});
