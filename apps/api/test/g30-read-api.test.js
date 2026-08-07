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
  assert.deepEqual(await service.advanceRoom({ roomId: 'r', userId: 'u', cursor }), { advanced: false, cursor });
  assert.deepEqual(tuple, { createdAtMicros: '9', id: 'm9' });
});

test('G30-A02 wrong-purpose and forbidden room reads fail before mutation', async () => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  let writes = 0;
  const service = createMessageReadService({ authorizeRoomRead: async () => false, cursorCodec: codec, repository: { advanceRoom: async () => { writes += 1; } } });
  await assert.rejects(service.advanceRoom({ roomId: 'r', userId: 'u', cursor: 'opaque' }), { code: 'room_forbidden', statusCode: 403 });
  assert.equal(writes, 0);
});
