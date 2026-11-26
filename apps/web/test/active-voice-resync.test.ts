import { afterEach, expect, test, vi } from 'vitest';
import { lobbyRoom } from './fixtures/answers';
import assert from 'node:assert/strict';
import { defined } from './helpers/assert';
import type { PublicPeer } from '@voiceroom/shared/contracts/rooms';
import type { RealtimeEvent } from '@/api/realtime';
import { installFakeWebSocket } from './fixtures/fake-websocket';

const localPeer = {
  id: 'peer-resync',
  name: 'Retry peer',
  joinedAt: 1,
  serverMuted: false,
  accountUserId: '',
  avatarColorKey: '',
  avatarAccent: null,
  avatarUrl: null
} satisfies PublicPeer;

async function loadRoomRealtime() {
  vi.resetModules();
  const sent: Array<{ type: string; payload: unknown; id?: string | undefined }> = [];
  const listeners = new Set<(event: RealtimeEvent) => void>();
  const restore = new Set<(epoch: number) => void>();
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
    onRestore(handler: (epoch: number) => void) {
      restore.add(handler);
      return () => {};
    },
    send(type: string, payload: unknown, id?: string) {
      sent.push({ type, payload, id });
    },
    subscribe(handler: (event: RealtimeEvent) => void) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }
  };
  vi.doMock('@/api/realtime', () => ({ getAppRealtime: () => connection }));
  return {
    realtime: await import('@/entities/room/room-realtime'),
    sent,
    emit: (event: RealtimeEvent) => listeners.forEach((handler) => handler(event)),
    reconnect: () => {
      connection.epoch++;
      restore.forEach((handler) => handler(connection.epoch));
    }
  };
}

afterEach(() => vi.useRealTimers());

test('a slow serial server acknowledges the single join sent for a Web restore', async () => {
  vi.useFakeTimers();
  vi.doUnmock('@/api/realtime');
  vi.resetModules();
  const sockets = installFakeWebSocket();
  const realtime = await import('@/entities/room/room-realtime');
  const member = { roomId: 'room-resync', peerId: localPeer.id, sessionToken: 'r'.repeat(32), name: localPeer.name };
  const received = vi.fn();
  const failed = vi.fn();
  const unsubscribe = realtime.subscribeRoomVoice(member.roomId, received);
  try {
    const first = sockets.latest();
    first.open();
    realtime.joinVoiceRoom(member);
    first.serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    const restored = sockets.latest();
    expect(restored).not.toBe(first);
    let serial = Promise.resolve();
    const send = restored.send.bind(restored);
    vi.spyOn(restored, 'send').mockImplementation((raw) => {
      send(raw);
      const command = restored.sent.at(-1);
      if (command?.type !== 'room.join') return;
      serial = serial.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        restored.receive({
          type: 'room.snapshot',
          id: command.id,
          payload: {
            mode: 'active',
            roomId: member.roomId,
            room: lobbyRoom({ roomId: member.roomId }),
            recentMessages: [],
            voiceActiveSince: null,
            peers: [localPeer]
          }
        });
      });
    });
    realtime.setActiveVoiceResyncFailureHandler(failed);
    restored.open();
    await vi.advanceTimersByTimeAsync(7_500);
    await serial;
    expect(received).toHaveBeenCalledOnce();
    expect(restored.sent.filter(({ type }) => type === 'room.join')).toHaveLength(1);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    realtime.setActiveVoiceResyncFailureHandler(null);
    unsubscribe();
  }
});

test('R3/R5: voice accepts only the current valid join acknowledgement and reuses the restore join', async () => {
  vi.useFakeTimers();
  const { realtime, sent, emit, reconnect } = await loadRoomRealtime();
  const member = { roomId: 'room-resync', peerId: 'peer-resync', sessionToken: 'r'.repeat(32), name: 'Retry peer' };
  const received = vi.fn();
  realtime.subscribeRoomVoice(member.roomId, received);
  realtime.joinVoiceRoom(member);
  const initialId = sent.at(-1)?.id;
  reconnect();
  const restoredId = sent.at(-1)?.id;
  expect(realtime.requestActiveVoiceResync(1, 8)).toBe(true);
  expect(sent).toHaveLength(2);
  expect(restoredId).toBeDefined();
  const snapshot = (id: string | undefined, roomId = member.roomId, hasPeer = true) =>
    emit({
      type: 'room.snapshot',
      ...(id ? { id } : {}),
      payload: {
        mode: 'active',
        roomId,
        room: lobbyRoom({ roomId }),
        recentMessages: [],
        voiceActiveSince: null,
        peers: hasPeer ? [localPeer] : []
      }
    });
  snapshot(initialId);
  snapshot(restoredId, 'another-room');
  snapshot(restoredId, member.roomId, false);
  expect(received).not.toHaveBeenCalled();
  snapshot(restoredId);
  expect(received).toHaveBeenCalledOnce();

  expect(realtime.requestActiveVoiceResync(1, 8, true)).toBe(true);
  const freshId = sent.at(-1)?.id;
  expect(freshId).toBeDefined();
  expect(freshId).not.toBe(restoredId);
  expect(sent.at(-1)?.payload).toEqual(expect.objectContaining(member));
  snapshot(restoredId);
  expect(received).toHaveBeenCalledOnce();
  snapshot(freshId);
  expect(received).toHaveBeenCalledTimes(2);
});

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
    assert.equal(sent.length, 3);

    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'room.snapshot',
        id: secondRequestId,
        payload: {
          mode: 'active',
          roomId: 'room-resync',
          room: lobbyRoom({ roomId: 'room-resync' }),
          peers: [localPeer],
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
