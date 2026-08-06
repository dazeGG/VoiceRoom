import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMessagingModule } from './messaging-module-loader.js';

test('G28-A01 older loads are single-flight, deduplicated and preserve the scroll anchor', async () => {
  const { createAnchoredHistory } = await loadMessagingModule(new URL('../src/lib/features/room/room-history.svelte.ts', import.meta.url), { replaceSvelteTick: true });
  let olderCalls = 0;
  const history = createAnchoredHistory({
    compare: (left, right) => left.createdAt - right.createdAt,
    loadPage: async (_scope, request) => request.mode === 'latest'
      ? { messages: [{ id: 'new', createdAt: 2 }], pageInfo: { before: 'before', hasMoreBefore: true } }
      : (olderCalls += 1, { messages: [{ id: 'old', createdAt: 1 }, { id: 'new', createdAt: 2 }], pageInfo: { before: undefined, hasMoreBefore: false } })
  });
  await history.open('room');
  const scroller = { scrollHeight: 100, scrollTop: 20 };
  const first = history.loadOlder(scroller); const second = history.loadOlder(scroller);
  scroller.scrollHeight = 160;
  await Promise.all([first, second]);
  assert.equal(olderCalls, 1);
  assert.deepEqual(history.state.messages.map((item) => item.id), ['old', 'new']);
  assert.equal(scroller.scrollTop, 80);
});

test('G28-A02 switching room cancels stale history results', async () => {
  const { createAnchoredHistory } = await loadMessagingModule(new URL('../src/lib/features/room/room-history.svelte.ts', import.meta.url), { replaceSvelteTick: true });
  let resolveOld;
  const oldPage = new Promise((resolve) => { resolveOld = resolve; });
  const history = createAnchoredHistory({ loadPage: (scope) => scope === 'old' ? oldPage : Promise.resolve({ messages: [{ id: 'new-room' }], pageInfo: { hasMoreBefore: false } }) });
  const oldOpen = history.open('old'); await history.open('new');
  resolveOld({ messages: [{ id: 'stale' }], pageInfo: { hasMoreBefore: false } }); await oldOpen;
  assert.deepEqual(history.state.messages.map((item) => item.id), ['new-room']);
});
