import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { roomStatus } from '../fixtures/answers';
import { stubFetch } from '../fixtures/fetch';
import { FakeWebSocket } from '../fixtures/fake-websocket';
import type { RealtimeEvent } from '@/api/realtime';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import type { MicrophoneCapture } from '@/features/room/client/core/types';

function pendingCapture(): { capture: MicrophoneCapture; raw: FakeMediaStreamTrack; output: FakeMediaStreamTrack } {
  const raw = new FakeMediaStreamTrack('join-raw', 'audio');
  const output = new FakeMediaStreamTrack('join-output', 'audio');
  raw.enabled = false;
  output.enabled = false;
  return {
    capture: {
      barrier: true,
      mode: 'browser',
      processor: null,
      rawStream: new FakeMediaStream([raw]),
      stream: new FakeMediaStream([output])
    },
    raw,
    output
  };
}

const voice = vi.hoisted((): { handler: ((event: RealtimeEvent) => void) | null } => ({ handler: null }));
const relief = vi.hoisted(() => ({
  callbacks: new Array<() => void>(),
  record: vi.fn(),
  note: vi.fn(),
  noise: vi.fn(async () => false),
  video: vi.fn(async () => {})
}));
vi.mock('@/features/room/client/room/call-strain', async (original) => ({
  ...(await original<object>()),
  startCallStrainWatch: (callback: () => void) => relief.callbacks.push(callback)
}));
vi.mock('@/features/room/client/room/call-quality', async (original) => ({
  ...(await original<object>()),
  recordCpuRelief: relief.record
}));
vi.mock('@/features/room/client/room/capture-diagnostics', async (original) => ({
  ...(await original<object>()),
  noteProcessingRelief: relief.note
}));
vi.mock('@/features/room/client/services/video-relief', async (original) => ({
  ...(await original<object>()),
  relieveVideo: relief.video
}));
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
  relieveNoiseSuppression: relief.noise,
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

test('a slow permission prompt explains listen-only join and late permission is stopped', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { openLocalMicrophone } = await import('@/features/room/client/services/microphone-service');
  const { showToast } = await import('@/features/room/client/ui/toast');
  let resolvePermission: (capture: MicrophoneCapture) => void = () => {};
  vi.mocked(openLocalMicrophone).mockImplementationOnce(() => new Promise((resolve) => (resolvePermission = resolve)));
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  const joining = room.joinRoom();
  await vi.advanceTimersByTimeAsync(15_000);
  await joining;
  expect(state.joined).toBe(true);
  expect(showToast).toHaveBeenCalledWith('Микрофон не ответил вовремя: вы в комнате без микрофона', {
    duration: 8000
  });
  const { capture, raw } = pendingCapture();
  resolvePermission(capture);
  await vi.advanceTimersByTimeAsync(0);
  expect(raw.readyState).toBe('ended');
  room.leaveRoom();
  vi.useRealTimers();
});

test('a cancelled permission prompt does not show a stale timeout explanation', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { openLocalMicrophone } = await import('@/features/room/client/services/microphone-service');
  const { showToast } = await import('@/features/room/client/ui/toast');
  let resolvePermission: (capture: MicrophoneCapture) => void = () => {};
  vi.mocked(openLocalMicrophone).mockImplementationOnce(() => new Promise((resolve) => (resolvePermission = resolve)));
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  const joining = room.joinRoom();
  await vi.advanceTimersByTimeAsync(1_000);
  room.leaveRoom();
  await vi.advanceTimersByTimeAsync(14_000);
  await joining;
  expect(showToast).not.toHaveBeenCalledWith('Микрофон не ответил вовремя: вы в комнате без микрофона', {
    duration: 8000
  });
  const { capture, raw } = pendingCapture();
  resolvePermission(capture);
  await vi.advanceTimersByTimeAsync(0);
  expect(raw.readyState).toBe('ended');
  vi.useRealTimers();
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

test('leaving during deferred device enumeration disposes a prepared candidate immediately', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { refreshDevices } = await import('@/features/room/client/ui/devices');
  const { openLocalMicrophone } = await import('@/features/room/client/services/microphone-service');
  const { connectLiveKitRoom } = await import('@/features/room/client/services/livekit-service');
  const { capture, raw, output } = pendingCapture();
  vi.mocked(openLocalMicrophone).mockResolvedValueOnce(capture);
  let finishEnumeration: () => void = () => {};
  vi.mocked(refreshDevices).mockImplementationOnce(
    () => new Promise((resolve) => (finishEnumeration = () => resolve([])))
  );
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  const joining = room.joinRoom();
  await vi.waitFor(() => expect(refreshDevices).toHaveBeenCalled());
  room.leaveRoom();
  expect(raw.readyState).toBe('ended');
  expect(output.readyState).toBe('ended');
  finishEnumeration();
  await joining;
  expect(connectLiveKitRoom).not.toHaveBeenCalled();
});

test('token or transport rejection disposes the uncommitted join candidate', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { refreshDevices } = await import('@/features/room/client/ui/devices');
  const { openLocalMicrophone } = await import('@/features/room/client/services/microphone-service');
  const { connectLiveKitRoom } = await import('@/features/room/client/services/livekit-service');
  const { capture, raw, output } = pendingCapture();
  vi.mocked(openLocalMicrophone).mockResolvedValueOnce(capture);
  vi.mocked(refreshDevices).mockResolvedValueOnce([]);
  vi.mocked(connectLiveKitRoom).mockRejectedValueOnce(new Error('token denied'));
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  await room.joinRoom();
  expect(raw.readyState).toBe('ended');
  expect(output.readyState).toBe('ended');
  expect(state.localStream).toBeNull();
});

test('a confirmed join publication keeps its committed capture until leave', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { refreshDevices } = await import('@/features/room/client/ui/devices');
  const { openLocalMicrophone } = await import('@/features/room/client/services/microphone-service');
  const { connectLiveKitRoom } = await import('@/features/room/client/services/livekit-service');
  const { capture, raw, output } = pendingCapture();
  vi.mocked(openLocalMicrophone).mockResolvedValueOnce(capture);
  vi.mocked(refreshDevices).mockResolvedValueOnce([]);
  vi.mocked(connectLiveKitRoom).mockImplementationOnce(async (_name, _isCurrent, candidate) => {
    if (candidate) Object.assign(state, { localStream: candidate.stream, localRawStream: candidate.rawStream });
    return true;
  });
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  await room.joinRoom();
  expect(raw.readyState).toBe('live');
  expect(output.readyState).toBe('live');
  room.leaveRoom();
  expect(raw.readyState).toBe('ended');
  expect(output.readyState).toBe('ended');
});

test('old deferred relief completion cannot update a new call or its diagnostics', async () => {
  vi.resetModules();
  setActivePinia(createPinia());
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch({ '/api/rooms/abc123': { body: roomStatus({ roomId: 'abc123' }) } });
  const room = await import('@/features/room/client/room/room');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  relief.callbacks.length = 0;
  relief.record.mockClear();
  relief.note.mockClear();
  let finishNoise: (value: boolean) => void = () => {};
  let finishVideo: () => void = () => {};
  relief.noise.mockImplementationOnce(() => new Promise((resolve) => (finishNoise = resolve)));
  relief.video.mockImplementationOnce(() => new Promise((resolve) => (finishVideo = resolve)));
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-1', sessionToken: 'session-1' });
  await room.joinRoom();
  relief.callbacks.at(-1)?.();
  room.leaveRoom();
  Object.assign(state, { roomId: 'abc123', peerId: 'peer-2', sessionToken: 'session-2' });
  await room.joinRoom();
  finishNoise(true);
  finishVideo();
  await Promise.resolve();
  await Promise.resolve();
  expect(relief.record).not.toHaveBeenCalled();
  expect(relief.note).not.toHaveBeenCalled();
  room.leaveRoom();
});
