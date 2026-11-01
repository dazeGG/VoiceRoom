// Devices come and go during a call: a saved choice outlives a device that is
// briefly missing, an unplugged microphone is reopened instead of carrying
// silence, and microphone switches never overlap.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MicrophoneCapture } from '@/features/room/client/core/types';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import * as devices from '@/features/room/client/ui/devices';
import * as microphone from '@/features/room/client/services/microphone-service';
import * as livekit from '@/features/room/client/services/livekit-service';
import * as playback from '@/features/room/client/services/media-playback-service';
import { showToast } from '@/features/room/client/ui/toast';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { defined } from '../helpers/assert';

vi.mock('@/features/room/client/services/livekit-service', () => ({
  publishLocalMicrophone: vi.fn(async () => {}),
  replaceLocalMicrophoneTrack: vi.fn(async () => true),
  unpublishLocalMicrophone: vi.fn(async () => {})
}));
vi.mock('@/features/room/client/services/media-playback-service', () => {
  let onSystem = false;
  return {
    isOutputOnSystemFallback: () => onSystem,
    moveAudioOutputToSystem: vi.fn(async () => {
      onSystem = true;
      return true;
    }),
    restoreAudioOutput: vi.fn(async () => {
      onSystem = false;
      return true;
    }),
    supportsAudioOutputSelection: () => true,
    syncAudioOutputDevices: vi.fn(async () => true)
  };
});
vi.mock('@/features/room/client/services/microphone-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openLocalMicrophone: vi.fn(),
  stopMicrophoneCapture: vi.fn()
}));
vi.mock('@/features/room/client/media/meters', () => ({
  attachMeter: vi.fn(),
  syncSpeakingThresholds: vi.fn()
}));
vi.mock('@/features/room/client/room/participants', () => ({ setParticipantSpeaking: vi.fn() }));
vi.mock('@/features/room/client/ui/controls', () => ({
  syncMicrophoneControls: vi.fn(),
  syncOutputDeviceUiState: vi.fn()
}));
vi.mock('@/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

// A class instance, like a real MediaStream, so the room state keeps it as is
// instead of wrapping it in a reactive proxy. Registered as the global
// MediaStream (jsdom has none), so `new MediaStream()` builds one.
class FakeStream {}

function stream(tracks: object[]): MediaStream {
  return Object.assign(new MediaStream(), { getAudioTracks: () => tracks });
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
  const capture: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: stream([raw]),
    stream: stream([published])
  };
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
  return Object.assign(new MediaDeviceInfo(), { kind, deviceId, groupId, label: deviceId });
}

let listed: MediaDeviceInfo[] = [];

// The mocked modules keep the instance they were first built with, so the
// whole graph is imported once and the room state is reset per test.
async function load() {
  setActivePinia(createPinia());
  const roomDeviceUi = useRoomDeviceUiStore();
  Object.assign(state, createInitialRoomState());
  const open = vi.mocked(microphone.openLocalMicrophone);
  const stop = vi.mocked(microphone.stopMicrophoneCapture);
  open.mockReset();
  stop.mockReset();
  vi.mocked(livekit.replaceLocalMicrophoneTrack).mockClear();
  vi.mocked(livekit.publishLocalMicrophone).mockClear();
  vi.mocked(livekit.unpublishLocalMicrophone).mockClear();
  vi.mocked(playback.syncAudioOutputDevices).mockClear();
  await playback.restoreAudioOutput();
  vi.mocked(playback.restoreAudioOutput).mockClear();
  vi.mocked(playback.moveAudioOutputToSystem).mockClear();
  vi.mocked(showToast).mockClear();

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
  vi.stubGlobal('MediaStream', FakeStream);
  // jsdom has no MediaDeviceInfo: a plain class stands in for it.
  vi.stubGlobal('MediaDeviceInfo', class {});
  vi.stubGlobal('navigator', {
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

test("Chrome's default and communications aliases do not show up as extra devices", async () => {
  const { devices, roomDeviceUi } = await load();
  listed = [
    device('audioinput', 'default', 'fifine'),
    device('audioinput', 'communications', 'fifine'),
    device('audioinput', 'fifine'),
    device('audiooutput', 'default', 'speakers'),
    device('audiooutput', 'communications', 'speakers'),
    device('audiooutput', 'speakers')
  ];
  await devices.refreshDevices();

  expect(roomDeviceUi.microphoneOptions.map((option) => option.value)).toEqual(['', 'fifine']);
  expect(roomDeviceUi.outputOptions.map((option) => option.value)).toEqual(['', 'speakers']);

  const settings = await import('@/features/home/model/sound-settings');
  expect((await settings.enumerateMicrophones()).map((option) => option.deviceId)).toEqual(['fifine']);
  expect((await settings.enumerateSpeakers()).map((option) => option.deviceId)).toEqual(['speakers']);
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
    .mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirstOpen = () => resolve(defined(captures[0], 'captures[0]').capture)))
    )
    .mockResolvedValueOnce(defined(captures[1], 'captures[1]').capture);
  joinWith(first);

  const one = devices.switchMicrophone();
  const two = devices.switchMicrophone();
  await Promise.resolve();
  expect(open).toHaveBeenCalledTimes(1);
  releaseFirstOpen();
  await Promise.all([one, two]);

  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(defined(captures[1], 'captures[1]').capture.stream);
  const stopped = stop.mock.calls.map(([capture]) => capture.stream);
  expect(stopped).toEqual([first.capture.stream, defined(captures[0], 'captures[0]').capture.stream]);
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

test('the sound moves to the system speaker while the saved one is away, and back when it returns', async () => {
  vi.useFakeTimers();
  const { state, devices, playback } = await load();
  state.outputDeviceId = 'headphones';

  listed = [device('audiooutput', 'speakers'), device('audiooutput', 'headphones')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(playback.moveAudioOutputToSystem).not.toHaveBeenCalled();
  expect(playback.restoreAudioOutput).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();

  listed = [device('audiooutput', 'speakers')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(playback.moveAudioOutputToSystem).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('Динамик недоступен, звук идёт через системный');

  // Still away: the person has been told once.
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(state.outputDeviceId).toBe('headphones');
  expect(playback.restoreAudioOutput).not.toHaveBeenCalled();

  listed = [device('audiooutput', 'speakers'), device('audiooutput', 'headphones')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(playback.restoreAudioOutput).toHaveBeenCalledTimes(1);
  expect(state.outputDeviceId).toBe('headphones');

  // Lost again later: that is news again.
  listed = [device('audiooutput', 'speakers')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);
  expect(showToast).toHaveBeenCalledTimes(2);
});

test('a saved speaker missing since the app started is selected once it is plugged in', async () => {
  vi.useFakeTimers();
  const { state, devices, playback } = await load();
  state.outputDeviceId = 'headphones';
  // The audio bus found the speaker missing on its own, before any device list.
  await playback.moveAudioOutputToSystem();

  listed = [device('audiooutput', 'speakers'), device('audiooutput', 'headphones')];
  devices.handleDeviceChange();
  await vi.advanceTimersByTimeAsync(1000);

  expect(playback.restoreAudioOutput).toHaveBeenCalledTimes(1);
});

test('nothing is said about a saved speaker while the browser hides device ids', async () => {
  const { state, devices, playback } = await load();
  state.outputDeviceId = 'headphones';

  listed = [device('audiooutput', '')];
  await devices.refreshDevices();
  await Promise.resolve();

  expect(playback.moveAudioOutputToSystem).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});

test('a failed pick goes back to the saved choice without leaving the sound off', async () => {
  localStorage.setItem('voice-room:output-device-id', 'gone');
  const { state, devices, roomDeviceUi, playback } = await load();
  state.outputDeviceId = 'gone';
  listed = [device('audiooutput', 'speakers')];
  await devices.refreshDevices();
  await vi.waitFor(() => expect(playback.moveAudioOutputToSystem).toHaveBeenCalled());

  vi.mocked(playback.syncAudioOutputDevices).mockResolvedValueOnce(false);
  vi.mocked(playback.restoreAudioOutput).mockClear();
  roomDeviceUi.outputDeviceId = 'speakers';
  await devices.switchOutputDevice();

  expect(playback.restoreAudioOutput).toHaveBeenCalledTimes(1);
  expect(state.outputDeviceId).toBe('gone');
  expect(localStorage.getItem('voice-room:output-device-id')).toBe('gone');
  expect(showToast).toHaveBeenCalledWith('Не удалось переключить динамик');
});

test('a saved speaker the system no longer has shows as unavailable and can be left for the system one', async () => {
  localStorage.setItem('voice-room:output-device-id', 'gone');
  const { state, devices, roomDeviceUi, playback } = await load();
  state.outputDeviceId = 'gone';

  listed = [device('audiooutput', 'default', 'speakers'), device('audiooutput', 'speakers')];
  await devices.refreshDevices();

  expect(roomDeviceUi.outputDeviceId).toBe('gone');
  expect(roomDeviceUi.outputOptions).toEqual([
    { value: '', label: 'Системный' },
    { value: 'speakers', label: 'speakers' },
    { value: 'gone', label: 'Устройство недоступно' }
  ]);

  roomDeviceUi.outputDeviceId = '';
  await devices.switchOutputDevice();

  expect(playback.syncAudioOutputDevices).toHaveBeenCalledTimes(1);
  expect(state.outputDeviceId).toBe('');
  expect(localStorage.getItem('voice-room:output-device-id')).toBeNull();
  await vi.waitFor(() => expect(roomDeviceUi.outputOptions.map((option) => option.value)).toEqual(['', 'speakers']));
});

test('a saved speaker is not called unavailable while the browser hides device ids', async () => {
  const { state, devices, roomDeviceUi } = await load();
  state.outputDeviceId = 'headphones';

  listed = [device('audiooutput', '')];
  await devices.refreshDevices();

  expect(roomDeviceUi.outputOptions).toEqual([{ value: '', label: 'Системный' }]);
  expect(roomDeviceUi.outputDeviceId).toBe('');
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
  const { showToast } = await import('@/features/room/client/ui/toast');
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
  const { isMicrophoneShownMuted } = await import('@/features/room/client/core/microphone-mute');
  state.joined = true;
  expect(isMicrophoneShownMuted()).toBe(false);
  state.microphoneMissing = true;
  expect(isMicrophoneShownMuted()).toBe(true);
});
