// Reopening a conversation shows the messages it had at once and swaps in the
// newest page when it arrives; a first visit, a linked message and a signed-out
// session start from nothing.

import { afterEach, expect, test } from 'vitest';
import { createAnchoredHistory, type AnchoredHistoryPage } from '@/shared/chat/anchored-history';
import { clearHistoryCache, createHistoryCache } from '@/shared/chat/history-cache';
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
    cache: createHistoryCache<Item>((messages) => messages.map((message) => ({ ...message })))
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

test.each(['add', 'edit', 'delete'])('a delayed opening snapshot preserves a live %s', async (change) => {
  const { anchored, pending } = history();
  const opening = anchored.open('a');
  if (change === 'add') anchored.upsert(item('live', 2));
  if (change === 'edit') anchored.upsert(item('old', 1, 'edited live'));
  if (change === 'delete') anchored.remove('old');
  defined(pending[0], 'opening').answer.resolve(page(item('old', 1)));
  await opening;
  expect(anchored.state.messages).toEqual(
    change === 'add' ? [item('old', 1), item('live', 2)] : change === 'edit' ? [item('old', 1, 'edited live')] : []
  );
});

test('revalidation drops stale cache entries but keeps only mutations received during the request', async () => {
  const { anchored, pending } = history();
  const first = anchored.open('a');
  defined(pending[0], 'first').answer.resolve(page(item('stale', 1), item('old', 2)));
  await first;
  anchored.close();
  const opening = anchored.open('a');
  anchored.upsert(item('live', 3));
  anchored.remove('old');
  defined(pending[1], 'revalidation').answer.resolve(page(item('old', 2)));
  await opening;
  expect(anchored.state.messages).toEqual([item('live', 3)]);
});

test('an older page cannot restore a deleted message or overwrite a live edit', async () => {
  const { anchored, pending } = history();
  const opening = anchored.open('a');
  defined(pending[0], 'first').answer.resolve({
    messages: [item('m3', 3)],
    pageInfo: { before: 'c3', hasMoreBefore: true }
  });
  await opening;
  const older = anchored.loadOlder(null);
  anchored.upsert(item('m2', 2, 'edited live'));
  anchored.remove('m1');
  defined(pending[1], 'older').answer.resolve(page(item('m1', 1), item('m2', 2)));
  await older;
  expect(anchored.state.messages).toEqual([item('m2', 2, 'edited live'), item('m3', 3)]);
});

test('live mutations from a closed scope never reach its replacement', async () => {
  const { anchored, pending } = history();
  const old = anchored.open('a');
  anchored.upsert(item('old-live', 1));
  anchored.close();
  const current = anchored.open('b');
  defined(pending[1], 'current').answer.resolve(page(item('current', 2)));
  await current;
  defined(pending[0], 'old').answer.resolve(page(item('old', 0)));
  await old;
  expect(anchored.state.messages).toEqual([item('current', 2)]);
});

test('a cursor resync does not replace full opening history or its pagination', async () => {
  const { anchored, pending } = history();
  const opening = anchored.open('a');
  const cursor = anchored.beginSnapshot('cursor');
  const current = cursor.apply([item('m3', 3, 'fresh')]);
  anchored.reconcileLatest(defined(current, 'accepted'), (message) => message.createdAt >= 3, cursor);
  defined(pending[0], 'opening').answer.resolve({
    messages: [item('m1', 1), item('m2', 2), item('m3', 3)],
    pageInfo: { before: 'c1', hasMoreBefore: true }
  });
  await opening;
  expect(anchored.state.messages).toEqual([item('m1', 1), item('m2', 2), item('m3', 3, 'fresh')]);
  expect(anchored.state.before).toBe('c1');
  expect(anchored.state.hasMoreBefore).toBe(true);
});

test('latest resync does not cancel an older page in flight', async () => {
  const { anchored, pending } = history();
  const opening = anchored.open('a');
  defined(pending[0], 'opening').answer.resolve({
    messages: [item('m3', 3)],
    pageInfo: { before: 'c3', hasMoreBefore: true }
  });
  await opening;
  const older = anchored.loadOlder(null);
  const latest = anchored.beginSnapshot();
  const current = latest.apply([item('m3', 3, 'fresh')]);
  anchored.reconcileLatest(defined(current, 'accepted'), (message) => message.createdAt >= 3, latest);
  defined(pending[1], 'older').answer.resolve(page(item('m1', 1), item('m2', 2)));
  await older;
  expect(anchored.state.messages).toEqual([item('m1', 1), item('m2', 2), item('m3', 3, 'fresh')]);
});

test('an overrun opening snapshot cannot advance pagination', async () => {
  const { anchored, pending } = history();
  const opening = anchored.open('a');
  for (let i = 0; i < 1001; i++) anchored.remove(String(i));
  defined(pending[0], 'opening').answer.resolve({ messages: [], pageInfo: { before: 'unsafe', hasMoreBefore: true } });
  await opening;
  expect(anchored.state.before).toBeUndefined();
  expect(anchored.state.hasMoreBefore).toBe(false);
});
