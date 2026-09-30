// A chat asks the reaction store to load every message it shows from inside an
// effect. Each message's reactions are fetched once: the store's own loading
// state must not make that effect ask again, or it refetches forever.

import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { createReactionStore } from '../../src/lib/shared/chat/reaction-store.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

test('an effect that loads the shown messages fetches each one once', async () => {
  const { calls } = stubFetch({
    'GET /api/reactions/room/kitchen/m1': { body: { ok: true, summaries: [] } },
    'GET /api/reactions/room/kitchen/m2': { body: { ok: true, summaries: [] } }
  });
  const store = createReactionStore();
  store.setConversation({ type: 'room', id: 'kitchen' });

  const stop = $effect.root(() => {
    $effect(() => {
      for (const id of ['m1', 'm2']) void store.load(id);
    });
  });
  try {
    flushSync();
    for (let round = 0; round < 10; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync();
    }
    expect(calls.map((call) => call.url).sort()).toEqual([
      '/api/reactions/room/kitchen/m1',
      '/api/reactions/room/kitchen/m2'
    ]);
  } finally {
    stop();
  }
});

test('a failed load is tried again the next time the message is shown', async () => {
  let answer: { status: number; body: unknown } = { status: 500, body: { ok: false, error: 'x', code: 'internal' } };
  const { calls } = stubFetch({ 'GET /api/reactions/room/kitchen/m1': () => answer });
  const store = createReactionStore();
  store.setConversation({ type: 'room', id: 'kitchen' });

  await store.load('m1');
  answer = {
    status: 200,
    body: { ok: true, summaries: [{ emoji: '👍', count: 1, reactedByMe: false, revision: '1' }] }
  };
  await store.load('m1');
  expect(calls).toHaveLength(2);
  expect(store.forMessage('m1').map((item) => item.emoji)).toEqual(['👍']);
});
