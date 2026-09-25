// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

async function loadRoomRealtime() {
  vi.resetModules();
  const sent = [];
  const connection = {
    epoch: 7,
    connected: true,
    ensureConnected() {},
    getConnectionEpoch() {
      return this.epoch;
    },
    isConnected() {
      return this.connected;
    },
    onRestore() {
      return () => {};
    },
    send(type, payload, id) {
      sent.push({ type, payload, id });
    },
    subscribe() {
      return () => {};
    }
  };
  vi.doMock('../src/lib/api/realtime', () => ({ getAppRealtime: () => connection }));
  vi.doMock('../src/lib/features/home/model/room-presence.svelte', () => ({ applyRoomSummary: () => {} }));
  return { realtime: await import('../src/lib/features/home/model/room-realtime.ts'), sent };
}

test('a delayed retryable error cannot cancel a newer successful voice resync attempt', async () => {
  const timers = new Map();
  let nextTimerId = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  vi.stubGlobal('setTimeout', (callback) => {
    const id = ++nextTimerId;
    timers.set(id, callback);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id) => timers.delete(id));

  try {
    const { realtime, sent } = await loadRoomRealtime();
    const failures = [];
    realtime.setActiveVoiceResyncFailureHandler((failure) => failures.push(failure));
    realtime.joinVoiceRoom({
      roomId: 'room-resync',
      peerId: 'peer-resync',
      sessionToken: 'r'.repeat(32),
      name: 'Retry peer'
    });

    assert.equal(realtime.requestActiveVoiceResync(1, 7), true);
    const firstRequestId = sent.at(-1).id;
    const [firstTimerId, firstTimer] = timers.entries().next().value;
    timers.delete(firstTimerId);
    firstTimer();
    const secondRequestId = sent.at(-1).id;

    assert.notEqual(firstRequestId, secondRequestId);
    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'error',
        payload: { code: 'reconnect_finalize_failed', id: firstRequestId }
      }),
      true
    );
    assert.deepEqual(failures, []);
    assert.equal(sent.filter((entry) => entry.id).length, 2);

    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'room.snapshot',
        id: secondRequestId,
        payload: { mode: 'active', roomId: 'room-resync' }
      }),
      true
    );
    assert.deepEqual(failures, []);
    assert.equal(timers.size, 0);
  } finally {
    vi.stubGlobal('setTimeout', originalSetTimeout);
    vi.stubGlobal('clearTimeout', originalClearTimeout);
  }
});
