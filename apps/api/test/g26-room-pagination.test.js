'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCursorCodec } = require('../src/platform/cursor-codec');
const { createRoomHistoryService } = require('../src/domains/messaging/room-history-service');

function message(id, micros) { return { id, roomId: 'room-a', createdAt: Number(micros), createdAtMicros: String(micros), text: id }; }

test('G26-A01 room pages preserve same-microsecond ids and bind cursors to the room', async () => {
  const codec = createCursorCodec({ keys: ['r'.repeat(32)], now: () => 1 });
  const calls = [];
  const repository = {
    roomExists: async () => true,
    async listLatest(input) { calls.push(input); return { messages: [message('a', 10), message('b', 10)], hasMoreBefore: false, hasMoreAfter: false }; },
    async listBefore(input) { calls.push(input); return { messages: [message('a', 10)], hasMoreBefore: false, hasMoreAfter: true }; }
  };
  const service = createRoomHistoryService({ repository, cursorCodec: codec });
  const latest = await service.getPage({ roomId: 'room-a' });
  assert.deepEqual(latest.messages.map(({ id }) => id), ['a', 'b']);
  assert.deepEqual((await service.getPage({ roomId: 'room-a', query: { mode: 'before', cursor: latest.pageInfo.after } })).messages.map(({ id }) => id), ['a']);
  await assert.rejects(service.getPage({ roomId: 'room-b', query: { mode: 'before', cursor: latest.pageInfo.after } }), { code: 'invalid_cursor', statusCode: 400 });
  assert.equal(calls[0].limit, 50);
});

test('G26-A02 visibility filtering cannot create duplicates', async () => {
  const codec = createCursorCodec({ keys: ['r'.repeat(32)] });
  const repository = { roomExists: async () => true, listLatest: async () => ({ messages: [message('visible', 1), message('hidden', 2)], hasMoreBefore: false, hasMoreAfter: false }) };
  const service = createRoomHistoryService({ repository, cursorCodec: codec, visibilityPolicy: { canViewRoomMessage: ({ message: item }) => item.id !== 'hidden' } });
  assert.deepEqual((await service.getPage({ roomId: 'room-a' })).messages.map(({ id }) => id), ['visible']);
});
