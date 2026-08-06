import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMessagingModule } from './messaging-module-loader.js';

test('G31-A01 multiple render advances coalesce to the newest pending cursor', async () => {
  const { createReadReconciliation } = await loadMessagingModule(new URL('../src/lib/shared/chat/read-reconciliation.svelte.ts', import.meta.url));
  const commits = [];
  const gate = Promise.withResolvers();
  const state = createReadReconciliation({ scope: 'room:r', legacy: false, commit: async (cursor) => { commits.push(cursor); if (commits.length === 1) await gate.promise; return cursor; } });
  const first = state.advanceAfterRender('c1'); state.advanceAfterRender('c2'); state.advanceAfterRender('c3'); gate.resolve(); await first;
  assert.deepEqual(commits, ['c1', 'c3']); state.dispose();
});

test('G31-A02 older or around loads alone cannot advance reads', async () => {
  const { createReadReconciliation } = await loadMessagingModule(new URL('../src/lib/shared/chat/read-reconciliation.svelte.ts', import.meta.url));
  let commits = 0;
  const state = createReadReconciliation({ scope: 'room:r', legacy: false, commit: async () => { commits += 1; } });
  await state.advanceAfterRender(undefined);
  assert.equal(commits, 0); state.dispose();
});

test('G31 realtime reconciliation failures stay non-blocking but observable', () => {
  const source = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
  assert.match(source, /catch \(cause\) \{\s*console\.error\('Failed to reconcile realtime room read cursor', cause\);/);
  assert.doesNotMatch(source, /markRealtimeRenderedRead[\s\S]*?catch \{\}/);
});
