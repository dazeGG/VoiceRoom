// A history page carries its messages' reactions, so showing those messages
// asks the server nothing; only a message that came without them is fetched.

import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { createReactionStore } from '../../src/lib/shared/chat/reaction-store.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

const thumbs = (count: number, revision: string) => ({ emoji: '👍', count, reactedByMe: false, revision });

test('messages from a history page show their reactions without a request', async () => {
  const { calls } = stubFetch({
    'GET /api/reactions/room/kitchen/live': { body: { ok: true, summaries: [thumbs(2, '5')] } }
  });
  const store = createReactionStore();
  store.setConversation({ type: 'room', id: 'kitchen' });
  const messages = [{ id: 'm1', reactions: [thumbs(1, '1')] }, { id: 'm2', reactions: [] }, { id: 'live' }];

  const stop = $effect.root(() => {
    $effect(() => {
      for (const message of messages) store.show(message);
    });
  });
  try {
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(calls.map((call) => call.url)).toEqual(['/api/reactions/room/kitchen/live']);
    expect(store.forMessage('m1').map((item) => item.count)).toEqual([1]);
    expect(store.forMessage('m2')).toEqual([]);
    expect(store.forMessage('live').map((item) => item.count)).toEqual([2]);
  } finally {
    stop();
  }
});

test('the same page copy does not undo a realtime update; a newer page replaces it', () => {
  stubFetch({});
  const store = createReactionStore();
  store.setConversation({ type: 'dm', id: 'peer' });
  const message = { id: 'm1', reactions: [thumbs(1, '1')] };

  store.show(message);
  store.applyServer('m1', thumbs(3, '2'));
  store.show(message);
  expect(store.forMessage('m1').map((item) => item.count)).toEqual([3]);

  store.show({ id: 'm1', reactions: [] });
  expect(store.forMessage('m1')).toEqual([]);
});

test('a new conversation takes its page copies afresh', () => {
  stubFetch({});
  const store = createReactionStore();
  const message = { id: 'm1', reactions: [thumbs(1, '1')] };
  store.setConversation({ type: 'dm', id: 'a' });
  store.show(message);
  store.setConversation({ type: 'dm', id: 'b' });
  expect(store.forMessage('m1')).toEqual([]);
  store.show(message);
  expect(store.forMessage('m1').map((item) => item.count)).toEqual([1]);
});
