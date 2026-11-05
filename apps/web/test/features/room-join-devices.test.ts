import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { roomStatus } from '../fixtures/answers';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';
import type { RealtimeEvent } from '@/api/realtime';

const voice = vi.hoisted((): { handler: ((event: RealtimeEvent) => void) | null } => ({ handler: null }));
vi.mock('@/entities/room/room-realtime', async (original) => ({
  ...(await original<object>()),
  subscribeRoomVoice: vi.fn((_room: string, handler: (event: RealtimeEvent) => void) => {
    voice.handler = handler;
    return () => {};
  })
}));
vi.mock('@/shared/log', async (original) => ({ ...(await original<object>()), reportVoiceJoinOutcome: vi.fn() }));

vi.mock('@/features/room/client/ui/devices', async (original) => ({
  ...(await original<object>()),
  refreshDevices: vi.fn(async () => {
    throw new Error('enumeration failed');
  })
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/features/room/client/services/microphone-service', async (original) => ({
  ...(await original<object>()),
  openLocalMicrophone: vi.fn(async () => null)
}));
vi.mock('@/features/room/client/services/livekit-service', async (original) => ({
  ...(await original<object>()),
  connectLiveKitRoom: vi.fn(async () => true),
  syncRemoteVideoVisibility: vi.fn()
}));

test('device enumeration failure does not prevent joining', async () => {
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  vi.mocked(reportVoiceJoinOutcome).mockClear();
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  await room.joinRoom();
  expect(state.joined).toBe(true);
  room.leaveRoom();
  expect(vi.mocked(reportVoiceJoinOutcome).mock.calls.map(([event]) => event.outcome)).toEqual(['success']);
});

test('a server refusal during a pending connection is failure, not cancellation', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { connectLiveKitRoom } = await import('@/features/room/client/services/livekit-service');
  const { reportVoiceJoinOutcome } = await import('@/shared/log');
  vi.mocked(reportVoiceJoinOutcome).mockClear();
  vi.mocked(connectLiveKitRoom).mockClear();
  let resolve: (value: boolean) => void = () => {};
  vi.mocked(connectLiveKitRoom).mockImplementationOnce(
    () =>
      new Promise((answer) => {
        resolve = answer;
      })
  );
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  const joining = room.joinRoom();
  await vi.waitFor(() => expect(connectLiveKitRoom).toHaveBeenCalled());
  voice.handler?.({ type: 'room.full', payload: { roomId: 'abc123', maxRoomPeers: 10 } });
  resolve(false);
  await joining;
  expect(vi.mocked(reportVoiceJoinOutcome).mock.calls.map(([event]) => event.outcome)).toEqual(['failure']);
});
