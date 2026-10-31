// Joining a room downloads the LiveKit library while the microphone opens,
// which can wait on a permission prompt, instead of after the token arrives.

import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';

const microphone = vi.hoisted(() => ({ refuse: (_error: Error) => {} }));

vi.mock('@/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/features/room/client/services/microphone-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLocalMicrophone: () => new Promise((_resolve, reject) => (microphone.refuse = reject))
}));
vi.mock('@/features/room/client/media/livekit-runtime', () => ({
  TRACK_SOURCE: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
  loadLiveKitClient: vi.fn(async () => ({
    Room: class {
      async connect() {
        throw new Error('no LiveKit in this test');
      }
      async disconnect() {}
      removeAllListeners() {}
    }
  }))
}));

test('LiveKit starts loading while the microphone permission is still pending', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
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
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { loadLiveKitClient } = await import('@/features/room/client/media/livekit-runtime');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });

  const joining = room.joinRoom();
  await vi.waitFor(() => expect(state.connecting).toBe(true));
  await vi.waitFor(() => expect(loadLiveKitClient).toHaveBeenCalled());
  expect(state.joined).toBe(false);

  microphone.refuse(new Error('NotAllowedError'));
  await joining;
  expect(state.joined).toBe(false);
  // The join went on to listen without a microphone; end it so no socket or recovery timer outlives the test.
  room.leaveRoom();
});
