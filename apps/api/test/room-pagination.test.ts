import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { createRoomHistoryService, type RoomHistoryRepository } from '../src/domains/messaging/room-history.service.ts';
import { fake } from './fakes/index.ts';

function message(id: string, micros: number) {
  return { id, roomId: 'room-a', createdAt: Number(micros), createdAtMicros: String(micros), text: id };
}

test('G26-A01 room pages preserve same-microsecond ids and bind cursors to the room', async () => {
  const codec = createCursorCodec({ keys: ['r'.repeat(32)], now: () => 1 });
  const calls: Array<{ limit: number }> = [];
  const repository = fake<RoomHistoryRepository>({
    roomExists: async () => true,
    async listLatest(input) {
      calls.push(input);
      return { messages: [message('a', 10), message('b', 10)], hasMoreBefore: false, hasMoreAfter: false };
    },
    async listBefore(input) {
      calls.push(input);
      return { messages: [message('a', 10)], hasMoreBefore: false, hasMoreAfter: true };
    }
  });
  const service = createRoomHistoryService({ repository, cursorCodec: codec });
  const latest = await service.getPage({ roomId: 'room-a' });
  assert.deepEqual(
    latest.messages.map(({ id }) => id),
    ['a', 'b']
  );
  assert.deepEqual(
    (
      await service.getPage({ roomId: 'room-a', query: { mode: 'before', cursor: latest.pageInfo.after } })
    ).messages.map(({ id }) => id),
    ['a']
  );
  await assert.rejects(
    service.getPage({ roomId: 'room-b', query: { mode: 'before', cursor: latest.pageInfo.after } }),
    { code: 'invalid_cursor', statusCode: 400 }
  );
  assert.equal(calls[0]?.limit, 50);
});

test('G26-A02 visibility filtering cannot create duplicates', async () => {
  const codec = createCursorCodec({ keys: ['r'.repeat(32)] });
  const repository = fake<RoomHistoryRepository>({
    roomExists: async () => true,
    listLatest: async () => ({
      messages: [message('visible', 1), message('hidden', 2)],
      hasMoreBefore: false,
      hasMoreAfter: false
    })
  });
  const service = createRoomHistoryService({
    repository,
    cursorCodec: codec,
    visibilityPolicy: { canViewRoomMessage: ({ message: item }) => (item as { id: string }).id !== 'hidden' }
  });
  assert.deepEqual(
    (await service.getPage({ roomId: 'room-a' })).messages.map(({ id }) => id),
    ['visible']
  );
});

test('a room page keeps link previews and sends times as epoch milliseconds', async () => {
  const codec = createCursorCodec({ keys: ['r'.repeat(32)] });
  const preview = { url: 'https://example.com/', title: 'Example', description: '', siteName: '', image: null };
  const repository = fake<RoomHistoryRepository>({
    roomExists: async () => true,
    listLatest: async () => ({
      messages: [
        {
          ...message('a', 1),
          createdAt: '2026-01-01T00:00:00.000Z',
          editedAt: new Date('2026-01-01T00:01:00.000Z'),
          expiresAt: new Date('2026-01-02T00:00:00.000Z'),
          linkPreview: preview
        }
      ],
      hasMoreBefore: false,
      hasMoreAfter: false
    })
  });
  const service = createRoomHistoryService({ repository, cursorCodec: codec });
  const [first] = (await service.getPage({ roomId: 'room-a' })).messages;
  assert.ok(first);
  assert.deepEqual(first.linkPreview, preview);
  assert.equal(first.createdAt, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(first.editedAt, Date.parse('2026-01-01T00:01:00.000Z'));
  assert.equal(first.expiresAt, Date.parse('2026-01-02T00:00:00.000Z'));
});
