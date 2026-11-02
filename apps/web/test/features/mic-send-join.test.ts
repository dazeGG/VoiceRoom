// The watch a joined call runs: its rebuild is the real microphone restart and its
// replacement the optional one, which a refusal cannot turn into a failed recovery.

import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';

const spies = vi.hoisted(() => ({
  reopenMicrophone: vi.fn(async () => true),
  requestLiveKitReplacement: vi.fn(async () => true)
}));

vi.mock('@/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshDevices: vi.fn(async () => {}),
  reopenMicrophone: spies.reopenMicrophone
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/features/room/client/services/livekit-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectLiveKitRoom: vi.fn(async () => true)
}));
vi.mock('@/features/room/client/recovery/room-recovery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestLiveKitReplacement: spies.requestLiveKitReplacement
}));
vi.mock('@/features/room/client/room/stats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // The test reads the microphone itself, without a poll of its own in between.
  startPeerLatencyStats: vi.fn()
}));

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a joined call rebuilds a stalled microphone, then replaces the connection, and stops watching on leaving', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const userAgent = vi
    .spyOn(window.navigator, 'userAgent', 'get')
    .mockReturnValue('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36');
  stubFetch({
    '/api/rooms/abc123': {
      body: {
        ok: true,
        exists: true,
        roomId: 'abc123',
        name: 'Планёрка',
        isStatic: true,
        avatarUrl: null,
        createdAt: 1,
        maxRoomPeers: 25,
        peers: 0
      }
    }
  });
  const room = await import('@/features/room/client/room/room');
  const { noteMicSend } = await import('@/features/room/client/room/mic-send');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });

  await room.joinRoom();
  expect(state.joined).toBe(true);

  let atMs = 1_000_000;
  const stalledPolls = async (count: number) => {
    for (let i = 0; i < count; i += 1) {
      atMs += 3000;
      noteMicSend({ atMs, deliveredSeconds: 100, contextSeconds: atMs / 1000 });
      await settled();
    }
  };
  await stalledPolls(6);
  expect(spies.reopenMicrophone).toHaveBeenCalledOnce();
  expect(spies.requestLiveKitReplacement).not.toHaveBeenCalled();
  await stalledPolls(5);
  expect(spies.reopenMicrophone).toHaveBeenCalledOnce();
  expect(spies.requestLiveKitReplacement).toHaveBeenCalledOnce();

  room.leaveRoom();
  await stalledPolls(12);
  expect(spies.reopenMicrophone).toHaveBeenCalledOnce();
  expect(spies.requestLiveKitReplacement).toHaveBeenCalledOnce();
  userAgent.mockRestore();
});
