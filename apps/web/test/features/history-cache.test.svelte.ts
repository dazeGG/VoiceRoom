// Reopening a conversation shows the messages it had at once and swaps in the
// newest page when it arrives; a first visit, a linked message and a signed-out
// session start from nothing.

import { afterEach, expect, test } from 'vitest';
import { createAnchoredHistory, type AnchoredHistoryPage } from '../../src/lib/shared/chat/anchored-history.svelte';
import { clearHistoryCache, createHistoryCache } from '../../src/lib/shared/chat/history-cache';
import { defined } from '../helpers/assert.ts';

type Item = { id: string; createdAt: number; text: string };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
    cache: createHistoryCache<Item>((messages) => $state.snapshot(messages))
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
  defined(pending[0], 'pending[0]').answer.resolve(page(item('m1', 1), item('m2', 2)));
  await first;
  anchored.upsert(item('m3', 3));

  const other = anchored.open('b');
  defined(pending[1], 'pending[1]').answer.resolve(page(item('x1', 1)));
  await other;

  const again = anchored.open('a');
  expect(anchored.state.loading).toBe(false);
  expect(ids(anchored.state.messages)).toEqual(['m1', 'm2', 'm3']);
  expect(pending[2]).toMatchObject({ scope: 'a', mode: 'latest' });

  defined(pending[2], 'pending[2]').answer.resolve(page(item('m2', 2, 'правка'), item('m3', 3), item('m4', 4)));
  await again;
  expect(ids(anchored.state.messages)).toEqual(['m2', 'm3', 'm4']);
  expect(defined(anchored.state.messages[0], 'anchored.state.messages[0]').text).toBe('правка');
});

test('older pages wait until the newest page replaced the kept copy', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  defined(pending[0], 'pending[0]').answer.resolve({
    messages: [item('m2', 2)],
    pageInfo: { before: 'c2', hasMoreBefore: true }
  });
  await first;
  anchored.close();

  const again = anchored.open('a');
  await anchored.loadOlder(null);
  expect(pending).toHaveLength(2);

  defined(pending[1], 'pending[1]').answer.resolve({
    messages: [item('m2', 2)],
    pageInfo: { before: 'c2', hasMoreBefore: true }
  });
  await again;
  void anchored.loadOlder(null);
  expect(pending[2]).toMatchObject({ mode: 'before' });
});

test('a linked message and a signed-out session do not use the kept copy', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  defined(pending[0], 'pending[0]').answer.resolve(page(item('m1', 1)));
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
  defined(pending[0], 'pending[0]').answer.resolve(page(item('m1', 1)));
  await first;
  anchored.close();

  const again = anchored.open('a');
  defined(pending[1], 'pending[1]').answer.reject(new Error('сеть'));
  await again;
  expect(ids(anchored.state.messages)).toEqual(['m1']);
  expect(anchored.state.error).toBe('сеть');
  expect(anchored.state.loading).toBe(false);
});

test('the room and DM caches share one limit of kept conversations, the least recently used going first', () => {
  const rooms = createHistoryCache<Item>((messages) => [...messages]);
  const directs = createHistoryCache<Item>((messages) => [...messages]);
  for (let index = 0; index < 20; index += 1) rooms.write(`r${index}`, [item(`m${index}`, index)]);
  expect(rooms.read('r0')).toHaveLength(1);

  directs.write('d0', [item('x1', 1)]);
  expect(rooms.read('r1')).toBeUndefined();
  expect(rooms.read('r0')).toHaveLength(1);
  expect(directs.read('d0')).toHaveLength(1);

  clearHistoryCache();
  expect(rooms.read('r0')).toBeUndefined();
  expect(directs.read('d0')).toBeUndefined();
});
