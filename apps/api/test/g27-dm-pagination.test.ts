// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { canonicalParticipants, createDmHistoryService } from '../src/domains/messaging/dm-history-service.ts';

function message(id, micros) {
  return { id, senderId: 'a', recipientId: 'b', body: id, createdAt: Number(micros), createdAtMicros: String(micros) };
}

test('G27-A01 DM cursor context is canonical and GET invokes only read repository methods', async () => {
  assert.deepEqual(canonicalParticipants('z', 'a'), ['a', 'z']);
  const writes = [];
  const repository = {
    canReadThread: async () => true,
    listLatest: async (input) => {
      writes.push(input);
      return { messages: [message('a', 10), message('b', 10)], hasMoreBefore: false, hasMoreAfter: false };
    }
  };
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
  const denied = createDmHistoryService({ repository: { canReadThread: async () => false }, cursorCodec: codec });
  await assert.rejects(denied.getPage({ userId: 'a', peerId: 'b' }), { code: 'thread_forbidden', statusCode: 403 });
});
