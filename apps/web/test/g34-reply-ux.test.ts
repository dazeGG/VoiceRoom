import { test } from 'vitest';
import assert from 'node:assert/strict';

test('G34-A01 reply submit retains draft on error and clears it on success', async () => {
  const { createReplyStore } = await import('../src/lib/shared/chat/reply-store.svelte.ts');
  const store = createReplyStore();
  store.setConversation({ type: 'room', id: 'r' });
  store.begin({ messageId: 'm', deleted: false, text: 'target' });
  store.setDraft('reply');
  assert.equal(
    await store.submit(async () => {
      throw new Error('retry');
    }),
    false
  );
  assert.equal(store.draft, 'reply');
  assert.equal(store.error, 'retry');
  assert.equal(
    await store.submit(async (input: { replyTo?: unknown }) => assert.deepEqual(input.replyTo, { messageId: 'm' })),
    true
  );
  assert.equal(store.draft, '');
  assert.equal(store.target, null);
});

test('G34-A02 deleted targets tombstone and jump requests remain accessible', async () => {
  const { createReplyStore } = await import('../src/lib/shared/chat/reply-store.svelte.ts');
  const store = createReplyStore();
  store.setConversation({ type: 'dm', id: 'u' });
  store.begin({ messageId: 'm', deleted: false });
  store.markTargetUnavailable('m');
  assert.deepEqual(store.target, { messageId: 'm', deleted: true, text: 'Сообщение недоступно' });
  store.requestJump('m');
  assert.equal(store.consumeJump(), 'm');
  assert.equal(store.consumeJump(), '');
});
