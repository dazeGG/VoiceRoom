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

test('G31-A03 two tabs accept repeated newer cursors and suppress identical or out-of-order envelopes', async () => {
  const original = globalThis.BroadcastChannel;
  class FakeBroadcastChannel {
    static instances = [];
    static transmissions = [];
    listeners = new Set();
    constructor(name) { this.name = name; FakeBroadcastChannel.instances.push(this); }
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
    postMessage(data) { FakeBroadcastChannel.transmissions.push({ sender: this, data }); for (const channel of FakeBroadcastChannel.instances) if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.emit(data)); }
    emit(data) { for (const listener of this.listeners) listener({ data }); }
    close() { this.listeners.clear(); }
  }
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  try {
    const { createReadReconciliation } = await loadMessagingModule(new URL('../src/lib/shared/chat/read-reconciliation.svelte.ts', import.meta.url));
    const commitsA = []; const commitsB = [];
    const tabA = createReadReconciliation({ scope: 'room:tabs', legacy: false, commit: async (cursor) => { commitsA.push(cursor); return cursor; } });
    const tabB = createReadReconciliation({ scope: 'room:tabs', legacy: false, commit: async (cursor) => { commitsB.push(cursor); return cursor; } });
    const flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
    for (const cursor of ['c1','c2','c3']) { await tabA.advanceAfterRender(cursor); await flush(); }
    assert.deepEqual(commitsA,['c1','c2','c3']);assert.deepEqual(commitsB,['c1','c2','c3']);
    const channelA=FakeBroadcastChannel.instances[0],channelB=FakeBroadcastChannel.instances[1];
    const sent=FakeBroadcastChannel.transmissions.filter(({sender})=>sender===channelA).map(({data})=>data);
    channelB.emit(sent[2]);channelB.emit(sent[1]);channelB.emit({...sent[1],cursor:'unseen-but-stale'});await flush();
    assert.deepEqual(commitsB,['c1','c2','c3']);
    await tabA.advanceAfterRender('c4');await flush();assert.deepEqual(commitsB,['c1','c2','c3','c4']);
    tabA.dispose();tabB.dispose();
  } finally {
    if (original === undefined) delete globalThis.BroadcastChannel; else globalThis.BroadcastChannel = original;
  }
});

test('G31 realtime reconciliation failures stay non-blocking but observable', () => {
  const source = readFileSync(new URL('../src/lib/features/room/components/RoomChatPanel.svelte', import.meta.url), 'utf8');
  assert.match(source, /catch \(cause\) \{\s*console\.error\('Failed to reconcile realtime room read cursor', cause\);/);
  assert.doesNotMatch(source, /markRealtimeRenderedRead[\s\S]*?catch \{\}/);
});
