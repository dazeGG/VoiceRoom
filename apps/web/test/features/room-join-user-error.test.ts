// Joining a room that fails with a message written for the user (for example
// the browser handing over no audio track) shows that message, not the
// generic "could not connect".

import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket } from '../fixtures/fake-websocket.ts';
import type * as Devices from '../../src/lib/features/room/client/ui/devices';
import type * as LiveKitService from '../../src/lib/features/room/client/services/livekit-service';

vi.mock('../../src/lib/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<typeof Devices>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../src/lib/features/room/client/services/livekit-service', async (importOriginal) => {
  const { UserFacingError } = await import('../../src/lib/features/room/client/core/utils');
  return {
    ...(await importOriginal<typeof LiveKitService>()),
    connectLiveKitRoom: vi.fn(async () => {
      throw new UserFacingError('Браузер не отдал аудио-трек');
    })
  };
});

test('a join failure meant for the user shows its own message', async () => {
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
    }
  });
  const room = await import('../../src/lib/features/room/client/room/room.ts');
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const { getConnectionStatusView } = await import('../../src/lib/features/room/client/ui/status.ts');
  const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });

  await room.joinRoom();

  expect(state.joined).toBe(false);
  expect(getConnectionStatusView().label).toBe('Ошибка подключения');
  expect(vi.mocked(showToast).mock.calls.at(-1)?.[0]).toBe('Браузер не отдал аудио-трек');
});
