// Joining a room when LiveKit cannot be reached: the user is told in Russian
// that voice is unreachable, and the status pill says there is no route to
// voice rather than a generic connection error.

import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket } from '../fixtures/fake-websocket.ts';

vi.mock('../../src/lib/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/lib/features/room/client/media/livekit-runtime', () => ({
  TRACK_SOURCE: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
  loadLiveKitClient: async () => ({
    Room: class {
      async connect(url: string) {
        throw new Error(`could not establish signal connection to ${url}: Failed to fetch`);
      }
      async disconnect() {}
      removeAllListeners() {}
    }
  })
}));

test('LiveKit being unreachable shows a Russian toast and "no route to voice"', async () => {
  vi.resetModules();
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
    },
    'POST /api/livekit-token': {
      body: {
        ok: true,
        gateCredentialId: 'gate',
        room: 'lk-room',
        token: 'token',
        ttlSeconds: 60,
        url: 'wss://lk.example'
      }
    }
  });
  const room = await import('../../src/lib/features/room/client/room/room.ts');
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const { getConnectionStatusView } = await import('../../src/lib/features/room/client/ui/status.ts');
  const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });

  await room.joinRoom();

  expect(state.joined).toBe(false);
  expect(getConnectionStatusView().label).toBe('Нет маршрута к голосу');
  expect(vi.mocked(showToast).mock.calls.at(-1)?.[0]).toBe(
    'LiveKit недоступен: голосовой сервер не отвечает, попробуйте подключиться позже'
  );
});
