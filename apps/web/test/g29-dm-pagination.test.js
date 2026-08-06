import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMessagingModule } from './messaging-module-loader.js';

test('G29-A01 DM history merges realtime edits/deletes with exact IDs', async () => {
  const { createAnchoredHistory } = await loadMessagingModule(new URL('../src/lib/features/room/room-history.svelte.ts', import.meta.url), { replaceSvelteTick: true });
  const history = createAnchoredHistory({ loadPage: async () => ({ messages: [{ id: 'a', body: 'old' }, { id: 'b', body: 'gone' }], pageInfo: { hasMoreBefore: false } }) });
  await history.open('dm:a:b');
  history.upsert({ id: 'a', body: 'edited' }); history.remove('b'); history.upsert({ id: 'c', body: 'new' });
  assert.deepEqual(history.state.messages, [{ id: 'a', body: 'edited' }, { id: 'c', body: 'new' }]);
});

test('G29-A02 latest reconciliation removes only stale rows in its window', async () => {
  const { createAnchoredHistory } = await loadMessagingModule(new URL('../src/lib/features/room/room-history.svelte.ts', import.meta.url), { replaceSvelteTick: true });
  const history = createAnchoredHistory({ loadPage: async () => ({ messages: [{ id: 'old', createdAt: 1 }, { id: 'stale', createdAt: 2 }], pageInfo: { hasMoreBefore: false } }) });
  await history.open('dm:a:b');
  history.reconcileLatest([{ id: 'fresh', createdAt: 3 }], (item) => item.createdAt >= 2);
  assert.deepEqual(history.state.messages.map((item) => item.id), ['old', 'fresh']);
});
