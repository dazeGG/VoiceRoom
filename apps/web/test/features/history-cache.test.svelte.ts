// Reopening a conversation shows the messages it had at once and swaps in the
// newest page when it arrives; a first visit, a linked message and a signed-out
// session start from nothing.

import { afterEach, expect, test } from 'vitest';
import { createAnchoredHistory, type AnchoredHistoryPage } from '../../src/lib/features/room/room-history.svelte';
import { clearHistoryCache } from '../../src/lib/shared/chat/history-cache';

type Item = { id: string; createdAt: number; text: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function page(...items: Item[]): AnchoredHistoryPage<Item> {
  return { messages: items, pageInfo: { before: items[0]?.id, hasMoreBefore: false } };
}

function item(id: string, createdAt: number, text = id): Item {
  return { id, createdAt, text };
}

function history() {
  const pending: Array<{
    scope: string;
    mode: string;
    answer: ReturnType<typeof deferred<AnchoredHistoryPage<Item>>>;
  }> = [];
  const anchored = createAnchoredHistory<Item>({
    loadPage: (scope, request) => {
      const answer = deferred<AnchoredHistoryPage<Item>>();
      pending.push({ scope, mode: request.mode, answer });
      return answer.promise;
    },
    compare: (left, right) => left.createdAt - right.createdAt,
    cacheKey: (scope) => `test:${scope}`
  });
  return { anchored, pending };
}

const ids = (items: Item[]) => items.map((message) => message.id);

afterEach(() => clearHistoryCache());

test('a conversation opened again shows its kept messages, then the newest page', async () => {
  const { anchored, pending } = history();

  const first = anchored.open('a');
  expect(anchored.state.loading).toBe(true);
  expect(anchored.state.messages).toEqual([]);
  pending[0].answer.resolve(page(item('m1', 1), item('m2', 2)));
  await first;
  anchored.upsert(item('m3', 3));

  const other = anchored.open('b');
  pending[1].answer.resolve(page(item('x1', 1)));
  await other;

  const again = anchored.open('a');
  expect(anchored.state.loading).toBe(false);
  expect(ids(anchored.state.messages)).toEqual(['m1', 'm2', 'm3']);
  expect(pending[2]).toMatchObject({ scope: 'a', mode: 'latest' });

  pending[2].answer.resolve(page(item('m2', 2, 'правка'), item('m3', 3), item('m4', 4)));
  await again;
  expect(ids(anchored.state.messages)).toEqual(['m2', 'm3', 'm4']);
  expect(anchored.state.messages[0].text).toBe('правка');
});

test('older pages wait until the newest page replaced the kept copy', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  pending[0].answer.resolve({ messages: [item('m2', 2)], pageInfo: { before: 'c2', hasMoreBefore: true } });
  await first;
  anchored.close();

  const again = anchored.open('a');
  await anchored.loadOlder(null);
  expect(pending).toHaveLength(2);

  pending[1].answer.resolve({ messages: [item('m2', 2)], pageInfo: { before: 'c2', hasMoreBefore: true } });
  await again;
  void anchored.loadOlder(null);
  expect(pending[2]).toMatchObject({ mode: 'before' });
});

test('a linked message and a signed-out session do not use the kept copy', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  pending[0].answer.resolve(page(item('m1', 1)));
  await first;
  anchored.close();

  void anchored.open('a', 'm1');
  expect(anchored.state.loading).toBe(true);
  expect(anchored.state.messages).toEqual([]);
  anchored.close();

  clearHistoryCache();
  void anchored.open('a');
  expect(anchored.state.loading).toBe(true);
  expect(anchored.state.messages).toEqual([]);
});

test('a kept copy stays shown when the newest page fails', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  pending[0].answer.resolve(page(item('m1', 1)));
  await first;
  anchored.close();

  const again = anchored.open('a');
  pending[1].answer.resolve(Promise.reject(new Error('сеть')) as never);
  await again;
  expect(ids(anchored.state.messages)).toEqual(['m1']);
  expect(anchored.state.error).toBe('сеть');
  expect(anchored.state.loading).toBe(false);
});
