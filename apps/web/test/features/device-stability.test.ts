// Devices come and go during a call: a saved choice outlives a device that is
// briefly missing, an unplugged microphone is reopened instead of carrying
// silence, and microphone switches never overlap.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MicrophoneCapture } from '../../src/lib/features/room/client/core/types.ts';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import * as devices from '../../src/lib/features/room/client/ui/devices.ts';
import * as microphone from '../../src/lib/features/room/client/services/microphone-service.ts';
import * as livekit from '../../src/lib/features/room/client/services/livekit-service.ts';
import * as playback from '../../src/lib/features/room/client/services/media-playback-service.ts';
import { roomDeviceUi } from '../../src/lib/features/room/room-device-ui.svelte.ts';

vi.mock('../../src/lib/features/room/client/services/livekit-service', () => ({
  publishLocalMicrophone: vi.fn(async () => {}),
  replaceLocalMicrophoneTrack: vi.fn(async () => true),
  unpublishLocalMicrophone: vi.fn(async () => {})
}));
vi.mock('../../src/lib/features/room/client/services/media-playback-service', () => ({
  supportsAudioOutputSelection: () => true,
  syncAudioOutputDevices: vi.fn(async () => true)
}));
vi.mock('../../src/lib/features/room/client/services/microphone-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openLocalMicrophone: vi.fn(),
  stopMicrophoneCapture: vi.fn()
}));
vi.mock('../../src/lib/features/room/client/media/meters', () => ({ attachMeter: vi.fn() }));
vi.mock('../../src/lib/features/room/client/room/participants', () => ({ setParticipantSpeaking: vi.fn() }));
vi.mock('../../src/lib/features/room/client/ui/controls', () => ({
  syncMicrophoneControls: vi.fn(),
  syncOutputDeviceUiState: vi.fn()
}));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

// A class instance, like a real MediaStream, so the room state keeps it as is
// instead of wrapping it in a reactive proxy.
class FakeStream {
  constructor(private readonly tracks: unknown[]) {}
  getAudioTracks() {
    return this.tracks;
  }
}

function fakeCapture(deviceId: string, groupId = deviceId) {
  const endedListeners: Array<() => void> = [];
  const raw = {
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    getSettings: () => ({ deviceId, groupId }),
    addEventListener: (_event: string, listener: () => void) => endedListeners.push(listener)
  };
  const published = { kind: 'audio', enabled: true };
  const capture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeStream([raw]),
    stream: new FakeStream([published])
  } as unknown as MicrophoneCapture;
  return {
    capture,
    published,
    unplug() {
      raw.readyState = 'ended';
      endedListeners.forEach((listener) => listener());
    }
  };
}

function device(kind: MediaDeviceKind, deviceId: string, groupId = deviceId) {
  return { kind, deviceId, groupId, label: deviceId } as MediaDeviceInfo;
}

let listed: MediaDeviceInfo[] = [];

// The mocked modules keep the instance they were first built with, so the
// whole graph is imported once and the room state is reset per test.
async function load() {
  Object.assign(state, createInitialRoomState());
  const open = vi.mocked(microphone.openLocalMicrophone);
  const stop = vi.mocked(microphone.stopMicrophoneCapture);
  open.mockReset();
  stop.mockReset();
  vi.mocked(livekit.replaceLocalMicrophoneTrack).mockClear();
  vi.mocked(livekit.publishLocalMicrophone).mockClear();
  vi.mocked(livekit.unpublishLocalMicrophone).mockClear();
  vi.mocked(playback.syncAudioOutputDevices).mockClear();

  /** Puts the room in a call that captures `current`. */
  const joinWith = (current: ReturnType<typeof fakeCapture>) => {
    state.joined = true;
    microphone.setLocalMicrophoneCapture(current.capture);
    devices.watchLocalMicrophone();
  };
  return { state, devices, roomDeviceUi, open, stop, joinWith, livekit, playback };
}

beforeEach(() => {
  localStorage.clear();
  listed = [];
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { enumerateDevices: async () => listed }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a saved microphone and speaker survive a list without them', async () => {
  localStorage.setItem('voice-room:microphone-device-id', 'usb-mic');
  localStorage.setItem('voice-room:output-device-id', 'headphones');
  const { state, devices, roomDeviceUi } = await load();
  state.microphoneDeviceId = 'usb-mic';
  state.outputDeviceId = 'headphones';

  // Before the microphone is allowed the browser lists devices without ids.
  listed = [device('audioinput', ''), device('audiooutput', '')];
  await devices.refreshDevices();

  expect(roomDeviceUi.microphoneId).toBe('');
  expect(state.microphoneDeviceId).toBe('usb-mic');
  expect(state.outputDeviceId).toBe('headphones');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('usb-mic');
  expect(localStorage.getItem('voice-room:output-device-id')).toBe('headphones');

  listed = [device('audioinput', 'usb-mic'), device('audiooutput', 'headphones')];
  await devices.refreshDevices();
  expect(roomDeviceUi.microphoneId).toBe('usb-mic');
  expect(roomDeviceUi.outputDeviceId).toBe('headphones');
});

test('an unplugged microphone is reopened and swapped under the publication', async () => {
  const { state, open, stop, joinWith, livekit } = await load();
  const first = fakeCapture('usb-mic');
  const second = fakeCapture('default');
  open.mockResolvedValueOnce(second.capture);
  joinWith(first);

  first.unplug();
  await vi.waitFor(() => expect(state.localStream).toBe(second.capture.stream));

  expect(livekit.replaceLocalMicrophoneTrack).toHaveBeenCalledWith(second.published);
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ stream: first.capture.stream }));
});

test('overlapping microphone switches run one after another and leave no capture open', async () => {
  const { state, devices, open, stop, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const captures = [fakeCapture('mic-b'), fakeCapture('mic-c')];
  let releaseFirstOpen = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirstOpen = () => resolve(captures[0].capture))))
    .mockResolvedValueOnce(captures[1].capture);
  joinWith(first);

  const one = devices.switchMicrophone();
  const two = devices.switchMicrophone();
  await Promise.resolve();
  expect(open).toHaveBeenCalledTimes(1);
  releaseFirstOpen();
  await Promise.all([one, two]);

  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(captures[1].capture.stream);
  const stopped = stop.mock.calls.map(([capture]) => capture.stream);
  expect(stopped).toEqual([first.capture.stream, captures[0].capture.stream]);
});

test('plugging the saved microphone back in moves the call onto it', async () => {
  vi.useFakeTimers();
  const { state, devices, open, joinWith } = await load();
  state.microphoneDeviceId = 'usb-mic';
  const fallback = fakeCapture('default', 'laptop');
  const restored = fakeCapture('usb-mic');
  open.mockResolvedValueOnce(restored.capture);
  joinWith(fallback);

  listed = [device('audioinput', 'default', 'laptop'), device('audioinput', 'usb-mic')];
  devices.handleDeviceChange();
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);

  expect(open).toHaveBeenCalledTimes(1);
  expect(state.localStream).toBe(restored.capture.stream);
});

test('a new system default microphone is followed when no device is saved', async () => {
  vi.useFakeTimers();
  const { state, devices, open, joinWith } = await load();
  const laptop = fakeCapture('default', 'laptop');
  const headset = fakeCapture('default', 'headset');
  open.mockResolvedValueOnce(headset.capture);
  joinWith(laptop);

  listed = [device('audioinput', 'default', 'laptop')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(open).not.toHaveBeenCalled();

  listed = [device('audioinput', 'default', 'headset'), device('audioinput', 'laptop')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.localStream).toBe(headset.capture.stream);
});

test('the saved speaker is selected again when it comes back', async () => {
  vi.useFakeTimers();
  const { state, devices, playback } = await load();
  state.outputDeviceId = 'headphones';

  listed = [device('audiooutput', 'speakers')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(playback.syncAudioOutputDevices).not.toHaveBeenCalled();

  listed = [device('audiooutput', 'speakers'), device('audiooutput', 'headphones')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(playback.syncAudioOutputDevices).toHaveBeenCalledTimes(1);
  expect(state.outputDeviceId).toBe('headphones');
});

test('a microphone that is lost with nothing to replace it leaves the call listening', async () => {
  const { state, open, stop, joinWith, livekit } = await load();
  const only = fakeCapture('usb-mic');
  open.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
  joinWith(only);

  only.unplug();
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));

  expect(state.joined).toBe(true);
  expect(state.localStream).toBeNull();
  expect(livekit.unpublishLocalMicrophone).toHaveBeenCalled();
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ stream: only.capture.stream }));
});

test('in the call without a microphone, plugging one in adds it muted', async () => {
  vi.useFakeTimers();
  const { state, devices, open, livekit } = await load();
  Object.assign(state, { joined: true, microphoneMissing: true });
  const plugged = fakeCapture('usb-mic');
  open.mockResolvedValueOnce(plugged.capture);

  listed = [device('audioinput', 'usb-mic')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);

  expect(state.localStream).toBe(plugged.capture.stream);
  expect(state.microphoneMissing).toBe(false);
  expect(state.muted).toBe(true);
  expect(plugged.published.enabled).toBe(false);
  expect(livekit.publishLocalMicrophone).toHaveBeenCalledTimes(1);
});

test('the microphone button in a call without one asks for it again and says why it failed', async () => {
  const { state, devices, open } = await load();
  const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
  Object.assign(state, { joined: true, microphoneMissing: true });
  open.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));

  await expect(devices.attachMicrophone()).resolves.toBe(false);
  expect(showToast).toHaveBeenCalledWith('Нет доступа к микрофону');
  expect(state.microphoneMissing).toBe(true);

  const granted = fakeCapture('default');
  open.mockResolvedValueOnce(granted.capture);
  await expect(devices.attachMicrophone()).resolves.toBe(true);
  expect(state.localStream).toBe(granted.capture.stream);
});

test('a listener without a microphone shows as muted to the room', async () => {
  const { state } = await load();
  const { isMicrophoneShownMuted } = await import('../../src/lib/features/room/client/core/microphone-mute.ts');
  state.joined = true;
  expect(isMicrophoneShownMuted()).toBe(false);
  state.microphoneMissing = true;
  expect(isMicrophoneShownMuted()).toBe(true);
});
