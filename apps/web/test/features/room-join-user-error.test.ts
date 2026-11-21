// Joining a room that fails with a message written for the user (for example
// the browser handing over no audio track) shows that message, not the
// generic "could not connect".

import { installWebCallPortsForTest } from '../helpers/call-ports';
import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';
import type * as Devices from '@voiceroom/call/engine/ui/devices';
import type * as LiveKitService from '@voiceroom/call/engine/services/livekit-service';

vi.mock('@voiceroom/call/engine/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<typeof Devices>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('@voiceroom/call/engine/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@voiceroom/call/engine/services/livekit-service', async (importOriginal) => {
  const { UserFacingError } = await import('@voiceroom/call/engine/core/utils');
  return {
    ...(await importOriginal<typeof LiveKitService>()),
    connectLiveKitRoom: vi.fn(async () => {
      throw new UserFacingError('Браузер не отдал аудио-трек');
    })
  };
});

test('a join failure meant for the user shows its own message', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  await installWebCallPortsForTest();
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
  const room = await import('@voiceroom/call/engine/room/room');
  const { state } = await import('@voiceroom/call/engine/core/room-runtime.store');
  const { getConnectionStatusView } = await import('@voiceroom/call/engine/ui/status');
  const { showToast } = await import('@voiceroom/call/engine/ui/toast');
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });

  await room.joinRoom();

  expect(state.joined).toBe(false);
  expect(getConnectionStatusView().label).toBe('Ошибка подключения');
  expect(vi.mocked(showToast).mock.calls.at(-1)?.[0]).toBe('Браузер не отдал аудио-трек');
});
