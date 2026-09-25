import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

test('G31-A01 multiple render advances coalesce to the newest pending cursor', async () => {
  const { createReadReconciliation } = await import('../src/lib/shared/chat/read-reconciliation.svelte.ts');
  const commits: unknown[] = [];
  const gate = Promise.withResolvers<void>();
  const state = createReadReconciliation({
    scope: 'room:r',
    legacy: false,
    commit: async (cursor) => {
      commits.push(cursor);
      if (commits.length === 1) await gate.promise;
      return cursor;
    }
  });
  const first = state.advanceAfterRender('c1');
  void state.advanceAfterRender('c2');
  void state.advanceAfterRender('c3');
  gate.resolve();
  await first;
  assert.deepEqual(commits, ['c1', 'c3']);
  state.dispose();
});

test('G31-A02 older or around loads alone cannot advance reads', async () => {
  const { createReadReconciliation } = await import('../src/lib/shared/chat/read-reconciliation.svelte.ts');
  let commits = 0;
  const state = createReadReconciliation({
    scope: 'room:r',
    legacy: false,
    commit: async () => {
      commits += 1;
    }
  });
  await state.advanceAfterRender(undefined);
  assert.equal(commits, 0);
  state.dispose();
});

test('G31-A03 two tabs accept repeated newer cursors and suppress identical or out-of-order envelopes', async () => {
  const original = globalThis.BroadcastChannel;
  type Listener = (event: { data: unknown }) => void;
  class FakeBroadcastChannel {
    static instances: FakeBroadcastChannel[] = [];
    static transmissions: Array<{ sender: FakeBroadcastChannel; data: unknown }> = [];
    listeners = new Set<Listener>();
    name: string;
    constructor(name: string) {
      this.name = name;
      FakeBroadcastChannel.instances.push(this);
    }
    addEventListener(type: string, listener: Listener) {
      if (type === 'message') this.listeners.add(listener);
    }
    postMessage(data: unknown) {
      FakeBroadcastChannel.transmissions.push({ sender: this, data });
      for (const channel of FakeBroadcastChannel.instances)
        if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.emit(data));
    }
    emit(data: unknown) {
      for (const listener of this.listeners) listener({ data });
    }
    close() {
      this.listeners.clear();
    }
  }
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  try {
    const { createReadReconciliation } = await import('../src/lib/shared/chat/read-reconciliation.svelte.ts');
    const commitsA: unknown[] = [];
    const commitsB: unknown[] = [];
    const tabA = createReadReconciliation({
      scope: 'room:tabs',
      legacy: false,
      commit: async (cursor) => {
        commitsA.push(cursor);
        return cursor;
      }
    });
    const tabB = createReadReconciliation({
      scope: 'room:tabs',
      legacy: false,
      commit: async (cursor) => {
        commitsB.push(cursor);
        return cursor;
      }
    });
    const flush = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    };
    for (const cursor of ['c1', 'c2', 'c3']) {
      await tabA.advanceAfterRender(cursor);
      await flush();
    }
    assert.deepEqual(commitsA, ['c1', 'c2', 'c3']);
    assert.deepEqual(commitsB, ['c1', 'c2', 'c3']);
    const [channelA, channelB] = FakeBroadcastChannel.instances;
    assert.ok(channelA && channelB);
    const sent = FakeBroadcastChannel.transmissions.filter(({ sender }) => sender === channelA).map(({ data }) => data);
    channelB.emit(sent[2]);
    channelB.emit(sent[1]);
    channelB.emit({ ...(sent[1] as object), cursor: 'unseen-but-stale' });
    await flush();
    assert.deepEqual(commitsB, ['c1', 'c2', 'c3']);
    await tabA.advanceAfterRender('c4');
    await flush();
    assert.deepEqual(commitsB, ['c1', 'c2', 'c3', 'c4']);
    tabA.dispose();
    tabB.dispose();
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    else globalThis.BroadcastChannel = original;
  }
});
