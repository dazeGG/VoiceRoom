import { test, vi } from 'vitest';
import { lobbyRoom } from './fixtures/answers';
import assert from 'node:assert/strict';
import { defined } from './helpers/assert';

async function loadRoomRealtime() {
  vi.resetModules();
  const sent: Array<{ type: string; payload: unknown; id?: string | undefined }> = [];
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
    send(type: string, payload: unknown, id?: string) {
      sent.push({ type, payload, id });
    },
    subscribe() {
      return () => {};
    }
  };
  vi.doMock('@/api/realtime', () => ({ getAppRealtime: () => connection }));
  vi.doMock('@/entities/room/room-presence.store', () => ({ applyRoomSummary: () => {} }));
  return { realtime: await import('@/entities/room/room-realtime'), sent };
}

test('a delayed retryable error cannot cancel a newer successful voice resync attempt', async () => {
  const timers = new Map<number, () => void>();
  let nextTimerId = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  vi.stubGlobal('setTimeout', (callback: () => void) => {
    const id = ++nextTimerId;
    timers.set(id, callback);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id: number) => timers.delete(id));

  try {
    const { realtime, sent } = await loadRoomRealtime();
    const failures: unknown[] = [];
    realtime.setActiveVoiceResyncFailureHandler((failure) => failures.push(failure));
    realtime.joinVoiceRoom({
      roomId: 'room-resync',
      peerId: 'peer-resync',
      sessionToken: 'r'.repeat(32),
      name: 'Retry peer'
    });

    assert.equal(realtime.requestActiveVoiceResync(1, 7), true);
    const firstRequestId = defined(sent.at(-1)?.id, 'first resync request id');
    const firstEntry = timers.entries().next().value;
    assert.ok(firstEntry);
    const [firstTimerId, firstTimer] = firstEntry;
    timers.delete(firstTimerId);
    firstTimer();
    const secondRequestId = defined(sent.at(-1)?.id, 'second resync request id');

    assert.notEqual(firstRequestId, secondRequestId);
    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'error',
        payload: { code: 'reconnect_finalize_failed', message: '', id: firstRequestId }
      }),
      true
    );
    assert.equal(failures.length, 0);
    assert.equal(sent.filter((entry) => entry.id).length, 2);

    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'room.snapshot',
        id: secondRequestId,
        payload: {
          mode: 'active',
          roomId: 'room-resync',
          room: lobbyRoom({ roomId: 'room-resync' }),
          peers: [],
          recentMessages: [],
          voiceActiveSince: null
        }
      }),
      true
    );
    assert.equal(failures.length, 0);
    assert.equal(timers.size, 0);
  } finally {
    vi.stubGlobal('setTimeout', originalSetTimeout);
    vi.stubGlobal('clearTimeout', originalClearTimeout);
  }
});
