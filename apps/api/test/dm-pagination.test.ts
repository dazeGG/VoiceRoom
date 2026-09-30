import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import {
  canonicalParticipants,
  createDmHistoryService,
  type DmHistoryRepository
} from '../src/domains/messaging/dm-history.service.ts';
import { fake } from './fakes/index.ts';

function message(id: string, micros: number) {
  return { id, senderId: 'a', recipientId: 'b', body: id, createdAt: Number(micros), createdAtMicros: String(micros) };
}

test('G27-A01 DM cursor context is canonical and GET invokes only read repository methods', async () => {
  assert.deepEqual(canonicalParticipants('z', 'a'), ['a', 'z']);
  const writes: unknown[] = [];
  const repository = fake<DmHistoryRepository>({
    canReadThread: async () => true,
    listLatest: async (input) => {
      writes.push(input);
      return { messages: [message('a', 10), message('b', 10)], hasMoreBefore: false, hasMoreAfter: false };
    }
  });
  const service = createDmHistoryService({ repository, cursorCodec: createCursorCodec({ keys: ['d'.repeat(32)] }) });
  const page = await service.getPage({ userId: 'a', peerId: 'b' });
  assert.deepEqual(
    page.messages.map(({ id }) => id),
    ['a', 'b']
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(repository).sort(), ['canReadThread', 'listLatest']);
});

test('G27-A02 unauthorized and cross-thread cursors fail without disclosure', async () => {
  const codec = createCursorCodec({ keys: ['d'.repeat(32)] });
  const denied = createDmHistoryService({
    repository: fake<DmHistoryRepository>({ canReadThread: async () => false }),
    cursorCodec: codec
  });
  await assert.rejects(denied.getPage({ userId: 'a', peerId: 'b' }), { code: 'thread_forbidden', statusCode: 403 });
});

test('a DM page sends its times as epoch milliseconds', async () => {
  const repository = fake<DmHistoryRepository>({
    canReadThread: async () => true,
    listLatest: async () => ({
      messages: [
        {
          ...message('a', 1),
          createdAt: '2026-01-01T00:00:00.000Z',
          editedAt: new Date('2026-01-01T00:01:00.000Z'),
          readAt: new Date('2026-01-01T00:02:00.000Z')
        }
      ],
      hasMoreBefore: false,
      hasMoreAfter: false
    })
  });
  const service = createDmHistoryService({ repository, cursorCodec: createCursorCodec({ keys: ['d'.repeat(32)] }) });
  const [first] = (await service.getPage({ userId: 'a', peerId: 'b' })).messages;
  assert.ok(first);
  assert.equal(first.createdAt, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(first.editedAt, Date.parse('2026-01-01T00:01:00.000Z'));
  assert.equal(first.readAt, Date.parse('2026-01-01T00:02:00.000Z'));
});
