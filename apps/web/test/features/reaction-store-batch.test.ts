// A long chat that opens with messages it has no reactions for asks about them in
// one request. One by one they took every database connection the server has and
// held a join up behind them: three people reloading a 90-message room made 660
// requests, and a voice token took two seconds instead of fifty milliseconds.

import { expect, test, vi } from 'vitest';
import { MAX_REACTION_BATCH } from '@voice-room/shared/contracts/messages';
import { createReactionStore } from '@/shared/chat/reaction-store';

const URL_START = '/api/reactions/room/kitchen?ids=';
const thumbs = { emoji: '👍', count: 2, reactedByMe: false, revision: '1' };

function storeWith(handler: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => handler(url));
  vi.stubGlobal('fetch', fetchMock);
  const store = createReactionStore();
  store.setConversation({ type: 'room', id: 'kitchen' });
  return { store, urls: () => fetchMock.mock.calls.map(([url]) => url) };
}

const ok = (messages: object) =>
  new Response(JSON.stringify({ ok: true, messages }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const flush = async () => {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

test('messages shown together cost one request', async () => {
  const { store, urls } = storeWith(() => ok({ m2: [thumbs] }));

  for (const id of ['m1', 'm2', 'm3']) store.show({ id });
  await flush();

  expect(urls()).toEqual([`${URL_START}m1,m2,m3`]);
  expect(store.forMessage('m2').map((item) => item.count)).toEqual([2]);
  expect(store.forMessage('m1')).toEqual([]);
  expect(store.loadingMessages).toEqual({});
});

test('more messages than one request may hold go in as many requests as they need', async () => {
  const { store, urls } = storeWith(() => ok({}));
  const count = MAX_REACTION_BATCH + 5;

  for (let i = 0; i < count; i += 1) store.show({ id: `m${i}` });
  await flush();

  const sizes = urls().map((url) => url.slice(URL_START.length).split(',').length);
  expect(sizes).toEqual([MAX_REACTION_BATCH, 5]);
});

test('a message already asked about, or that came with its reactions, is not asked about', async () => {
  const { store, urls } = storeWith(() => ok({}));

  store.show({ id: 'carried', reactions: [] });
  store.show({ id: 'm1' });
  await flush();
  store.show({ id: 'm1' });
  await flush();

  expect(urls()).toEqual([`${URL_START}m1`]);
});

test('a failed request is tried again the next time its messages are shown', async () => {
  let fail = true;
  const { store, urls } = storeWith(() =>
    fail
      ? new Response(JSON.stringify({ ok: false, error: 'x', code: 'internal' }), { status: 500 })
      : ok({ m1: [thumbs] })
  );

  store.show({ id: 'm1' });
  await flush();
  expect(store.forMessage('m1')).toEqual([]);
  expect(store.loadingMessages).toEqual({});

  fail = false;
  store.show({ id: 'm1' });
  await flush();

  expect(urls()).toHaveLength(2);
  expect(store.forMessage('m1').map((item) => item.count)).toEqual([2]);
});

test('an answer that arrives after moving to another conversation is not shown there', async () => {
  let answer: (value: Response) => void = () => {};
  const { store } = storeWith(() => new Promise<Response>((resolve) => (answer = resolve)));

  store.show({ id: 'm1' });
  await flush();
  store.setConversation({ type: 'room', id: 'attic' });
  answer(ok({ m1: [thumbs] }));
  await flush();

  expect(store.forMessage('m1')).toEqual([]);
});
