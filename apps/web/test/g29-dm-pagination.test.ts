import { test } from 'vitest';
import assert from 'node:assert/strict';

test('G29-A01 DM history merges realtime edits/deletes with exact IDs', async () => {
  const { createAnchoredHistory } = await import('../src/lib/features/room/room-history.svelte.ts');
  const history = createAnchoredHistory({ loadPage: async () => ({ messages: [{ id: 'a', body: 'old' }, { id: 'b', body: 'gone' }], pageInfo: { hasMoreBefore: false } }) });
  await history.open('dm:a:b');
  history.upsert({ id: 'a', body: 'edited' }); history.remove('b'); history.upsert({ id: 'c', body: 'new' });
  assert.deepEqual(history.state.messages, [{ id: 'a', body: 'edited' }, { id: 'c', body: 'new' }]);
});

test('G29-A02 latest reconciliation removes only stale rows in its window', async () => {
  const { createAnchoredHistory } = await import('../src/lib/features/room/room-history.svelte.ts');
  const history = createAnchoredHistory({ loadPage: async () => ({ messages: [{ id: 'old', createdAt: 1 }, { id: 'stale', createdAt: 2 }], pageInfo: { hasMoreBefore: false } }) });
  await history.open('dm:a:b');
  history.reconcileLatest([{ id: 'fresh', createdAt: 3 }], (item: { createdAt: number }) => item.createdAt >= 2);
  assert.deepEqual(history.state.messages.map((item: { id: string }) => item.id), ['old', 'fresh']);
});
