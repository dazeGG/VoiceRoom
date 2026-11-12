// A microphone action that does not apply says why, once, and an action the
// user superseded or left behind says nothing.
import { afterEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import * as devices from '@/features/room/client/ui/devices';
import type { MicrophoneCapture } from '@/features/room/client/core/types';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { setLocalMicrophoneCapture } from '@/features/room/client/services/microphone-service';
import { showToast } from '@/features/room/client/ui/toast';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import { defined } from '../helpers/assert';

vi.mock('@/features/room/client/media/livekit-runtime', () => ({
  TRACK_SOURCE: { Microphone: 'microphone' },
  loadLiveKitClient: async () => ({ Track: { Source: { Microphone: 'microphone' } } })
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('@/features/room/client/media/meters', () => ({ attachMeter: vi.fn(), syncSpeakingThresholds: vi.fn() }));
vi.mock('@/features/room/client/ui/controls', () => ({
  syncMicrophoneControls: vi.fn(),
  syncOutputDeviceUiState: vi.fn()
}));
const captureWork = vi.hoisted(() => ({
  open: vi.fn<(isCurrent: () => boolean) => Promise<MicrophoneCapture>>(),
  stop: vi.fn()
}));
vi.mock('@/features/room/client/services/microphone-service', async (original) => ({
  ...(await original<object>()),
  openLocalMicrophone: captureWork.open,
  stopMicrophoneCapture: captureWork.stop
}));

afterEach(() => {
  devices.invalidateMicrophoneActions();
  vi.mocked(showToast).mockReset();
  captureWork.open.mockReset();
  vi.useRealTimers();
});

function capture(id: string, barrier = true): MicrophoneCapture {
  return {
    barrier,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([new FakeMediaStreamTrack(`${id}-raw`, 'audio')]),
    stream: new FakeMediaStream([new FakeMediaStreamTrack(`${id}-output`, 'audio')])
  };
}

const toasts = () => vi.mocked(showToast).mock.calls.map(([message]) => message);

function inCallWithMicrophone(replace: () => Promise<void>) {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const previous = capture('old', false);
  const publication = {
    track: {
      mediaStreamTrack: defined(previous.stream?.getAudioTracks()[0], 'old output'),
      replaceTrack: async (track: MediaStreamTrack) => {
        publication.track.mediaStreamTrack = track;
        await replace();
      }
    }
  };
  const room = { localParticipant: { unpublishTrack: vi.fn(async () => {}), publishTrack: vi.fn() } };
  Object.assign(state, { joined: true, livekitRoom: room, muted: false });
  setLocalMicrophoneCapture(previous);
  Object.assign(state, { localMicPublication: publication });
}

/** getUserMedia answers when finish() is called; a stale action throws, as microphone-service does. */
function pendingPermission(): () => void {
  let finish = () => {};
  captureWork.open.mockImplementationOnce(
    (isCurrent) =>
      new Promise((resolve, reject) => {
        finish = () => (isCurrent() ? resolve(capture('granted')) : reject(new Error('Microphone action is stale')));
      })
  );
  return () => finish();
}

test('a device switch the SDK refuses says the call lost its microphone', async () => {
  inCallWithMicrophone(async () => {
    throw new Error('sender.replaceTrack rejected');
  });
  captureWork.open.mockResolvedValueOnce(capture('new'));
  useRoomDeviceUiStore().microphoneId = 'mic-b';
  expect(await devices.switchMicrophone()).toBe(false);
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));
  expect(toasts()).toEqual(['Не удалось переключить микрофон: вы в комнате без микрофона']);
});

test('a device switch the SDK never finishes says the call lost its microphone', async () => {
  vi.useFakeTimers();
  inCallWithMicrophone(() => new Promise(() => {}));
  captureWork.open.mockResolvedValueOnce(capture('new'));
  useRoomDeviceUiStore().microphoneId = 'mic-b';
  const switching = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await switching).toBe(false);
  expect(state.localStream).toBeNull();
  expect(toasts()).toEqual(['Не удалось переключить микрофон: вы в комнате без микрофона']);
});

test('a microphone that does not open in time for a device switch says so and keeps the call microphone', async () => {
  vi.useFakeTimers();
  inCallWithMicrophone(async () => {});
  const previousStream = state.localStream;
  captureWork.open.mockImplementationOnce(() => new Promise(() => {}));
  useRoomDeviceUiStore().microphoneId = 'mic-b';
  const switching = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await switching).toBe(false);
  expect(state.localStream).toBe(previousStream);
  expect(toasts()).toEqual(['Не удалось переключить микрофон']);
});

test('leaving while the microphone button waits for permission says nothing afterwards', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const room = { localParticipant: { publishTrack: vi.fn(), unpublishTrack: vi.fn(async () => {}) } };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: null });
  const finish = pendingPermission();
  const attaching = devices.attachMicrophoneOutcome();
  await Promise.resolve();
  devices.invalidateMicrophoneActions(); // leave
  Object.assign(state, { joined: false, livekitRoom: null });
  finish();
  expect(await attaching).toBe('stale');
  expect(toasts()).toEqual([]);
});

test('picking a device while the microphone button waits for permission does not report the first as unavailable', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const publication = { track: { replaceTrack: vi.fn() }, mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}) };
  const room = {
    localParticipant: {
      publishTrack: vi.fn(async () => publication),
      unpublishTrack: vi.fn(async () => {}),
      trackPublications: new Map<string, unknown>()
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: null, muted: true });
  const finish = pendingPermission();
  captureWork.open.mockResolvedValueOnce(capture('picked'));
  const attaching = devices.attachMicrophone();
  await Promise.resolve();
  useRoomDeviceUiStore().microphoneId = 'mic-b';
  const switching = devices.switchMicrophone();
  finish();
  expect(await Promise.all([attaching, switching])).toEqual([false, true]);
  expect(toasts()).toEqual(['Микрофон подключен']);
});

test('a permission prompt answered after the deadline says to try again', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const room = { localParticipant: { publishTrack: vi.fn(), unpublishTrack: vi.fn(async () => {}) } };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: null });
  pendingPermission();
  const attaching = devices.attachMicrophoneOutcome();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await attaching).toBe('timed_out');
  expect(toasts()).toEqual(['Микрофон не ответил вовремя: попробуйте ещё раз']);
});
