// Devices come and go during a call: a saved choice outlives a device that is
// briefly missing, an unplugged microphone is reopened instead of carrying
// silence, and microphone switches never overlap.

import { createPinia, setActivePinia } from 'pinia';
import { markRaw } from 'vue';
import { Room, RoomEvent } from 'livekit-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MicrophoneCapture } from '@/features/room/client/core/types';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import * as devices from '@/features/room/client/ui/devices';
import * as microphone from '@/features/room/client/services/microphone-service';
import * as livekit from '@/features/room/client/services/livekit-service';
import * as publications from '@/features/room/client/services/livekit/local-publications';
import * as playback from '@/features/room/client/services/media-playback-service';
import { showToast } from '@/features/room/client/ui/toast';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { defined } from '../helpers/assert';

vi.mock('@/features/room/client/services/livekit-service', () => ({
  publishLocalMicrophone: vi.fn(async () => {}),
  replaceLocalMicrophoneTrack: vi.fn(async () => true),
  syncLocalMicrophonePublicationMuted: vi.fn(async () => {}),
  unpublishLocalMicrophone: vi.fn(async () => {})
}));
const microphonePublication = vi.hoisted(() => ({
  track: { id: 'publication-track', replaceTrack: vi.fn(async () => {}) },
  mute: vi.fn(),
  unmute: vi.fn()
}));
vi.mock('@/features/room/client/services/livekit/local-publications', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publishLocalMicrophoneForRoom: vi.fn(async () => microphonePublication),
  replaceLocalMicrophoneTrackForPublication: vi.fn(async () => true)
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
  const published = { kind: 'audio', enabled: true, readyState: 'live' };
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
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockClear();
  vi.mocked(publications.publishLocalMicrophoneForRoom).mockClear();
  vi.mocked(livekit.unpublishLocalMicrophone).mockClear();
  vi.mocked(playback.syncAudioOutputDevices).mockClear();
  await playback.restoreAudioOutput();
  vi.mocked(playback.restoreAudioOutput).mockClear();
  vi.mocked(playback.moveAudioOutputToSystem).mockClear();
  vi.mocked(showToast).mockClear();

  /** Puts the room in a call that captures `current`. */
  const joinWith = (current: ReturnType<typeof fakeCapture>) => {
    state.joined = true;
    Object.assign(microphonePublication.track, { mediaStreamTrack: current.published });
    Object.assign(state, { localMicPublication: markRaw(microphonePublication) });
    microphone.setLocalMicrophoneCapture(current.capture);
    devices.watchLocalMicrophone();
  };
  const unpublishTrack = vi.fn(async () => {});
  Object.assign(state, { livekitRoom: { localParticipant: { unpublishTrack } } });
  return { state, devices, roomDeviceUi, open, stop, joinWith, livekit, playback, unpublishTrack };
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
  const { state, open, stop, joinWith } = await load();
  const first = fakeCapture('usb-mic');
  const second = fakeCapture('default');
  open.mockResolvedValueOnce(second.capture);
  joinWith(first);

  first.unplug();
  await vi.waitFor(() => expect(state.localStream).toBe(second.capture.stream));

  expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledWith(
    state.livekitRoom,
    microphonePublication,
    second.published,
    expect.any(Function)
  );
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ stream: first.capture.stream }));
});

test('overlapping microphone switches apply only the latest device without stale rollback', async () => {
  const { state, devices, roomDeviceUi, open, stop, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const captures = [fakeCapture('mic-b'), fakeCapture('mic-c')];
  let releaseFirstOpen = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirstOpen = () => resolve(defined(captures[0], 'captures[0]').capture)))
    )
    .mockResolvedValueOnce(defined(captures[1], 'captures[1]').capture);
  joinWith(first);

  roomDeviceUi.microphoneId = 'mic-b';
  const one = devices.switchMicrophone();
  roomDeviceUi.microphoneId = 'mic-c';
  const two = devices.switchMicrophone();
  await Promise.resolve();
  expect(open).toHaveBeenCalledTimes(1);
  releaseFirstOpen();
  await expect(one).resolves.toBe(false);
  await expect(two).resolves.toBe(true);

  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(defined(captures[1], 'captures[1]').capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-c');
  expect(showToast).not.toHaveBeenCalledWith('Не удалось переключить микрофон');
  const stopped = stop.mock.calls.map(([capture]) => capture.stream);
  expect(stopped).toEqual([defined(captures[0], 'captures[0]').capture.stream, first.capture.stream]);
});

test('gate enable survives a microphone switch waiting for SDK replacement', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const ungated = fakeCapture('mic-b');
  const gated = fakeCapture('mic-b');
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(ungated.capture).mockResolvedValueOnce(gated.capture);
  state.gateThresholdDb = -100;
  joinWith(first);
  vi.useFakeTimers();

  roomDeviceUi.microphoneId = 'mic-b';
  const device = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(0);
  expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledOnce();
  devices.updateGateThresholdFromSlider(-40);
  await vi.advanceTimersByTimeAsync(700);
  expect(state.gateThresholdDb).toBe(-40);
  expect(localStorage.getItem('voice-room:gate-threshold-db')).toBe('-40');
  finishReplace();
  await vi.advanceTimersByTimeAsync(0);
  expect(await device).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(gated.capture.stream);
});

test('a newer device selection supersedes a queued gate rebuild without losing gate settings', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-b');
  const latest = fakeCapture('mic-c');
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(superseded.capture).mockResolvedValueOnce(latest.capture);
  state.gateThresholdDb = -100;
  joinWith(first);
  vi.useFakeTimers();

  roomDeviceUi.microphoneId = 'mic-b';
  const oldDevice = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(0);
  devices.updateGateThresholdFromSlider(-40);
  await vi.advanceTimersByTimeAsync(700);
  roomDeviceUi.microphoneId = 'mic-c';
  const newDevice = devices.switchMicrophone();
  finishReplace();
  await vi.advanceTimersByTimeAsync(0);
  expect(await oldDevice).toBe(false);
  expect(await newDevice).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(latest.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(state.gateThresholdDb).toBe(-40);
});

test('a newer noise choice supersedes a queued gate rebuild while retaining the gate threshold', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-a');
  const latest = fakeCapture('mic-a');
  latest.capture.mode = 'off';
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(superseded.capture).mockResolvedValueOnce(latest.capture);
  state.gateThresholdDb = -100;
  joinWith(first);
  vi.useFakeTimers();

  roomDeviceUi.noiseMode = 'browser';
  const oldNoise = devices.switchNoiseMode();
  await vi.advanceTimersByTimeAsync(0);
  devices.updateGateThresholdFromSlider(-40);
  await vi.advanceTimersByTimeAsync(700);
  roomDeviceUi.noiseMode = 'off';
  const newNoise = devices.switchNoiseMode();
  finishReplace();
  await vi.advanceTimersByTimeAsync(0);
  await Promise.all([oldNoise, newNoise]);
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(latest.capture.stream);
  expect(state.noiseMode).toBe('off');
  expect(state.gateThresholdDb).toBe(-40);
});

test('current manual capture ending during SDK replace restores the confirmed device preference', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const ended = fakeCapture('mic-b');
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(ended.capture);
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneOptions = [
    { value: '', label: 'System' },
    { value: 'mic-a', label: 'A' },
    { value: 'mic-b', label: 'B' }
  ];
  roomDeviceUi.microphoneId = 'mic-b';

  const switching = devices.switchMicrophone();
  await vi.waitFor(() => expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledOnce());
  ended.unplug();
  finishReplace();
  expect(await switching).toBe(false);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-a');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-a');
  expect(roomDeviceUi.microphoneId).toBe('mic-a');
});

test('ended superseded capture cannot roll back a newer device owner', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const ended = fakeCapture('mic-b');
  const latest = fakeCapture('mic-c');
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(ended.capture).mockResolvedValueOnce(latest.capture);
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const older = devices.switchMicrophone();
  await vi.waitFor(() => expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledOnce());
  roomDeviceUi.microphoneId = 'mic-c';
  const newer = devices.switchMicrophone();
  ended.unplug();
  finishReplace();
  expect(await older).toBe(false);
  expect(await newer).toBe(true);
  expect(state.localStream).toBe(latest.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-c');
});

test('overlapping noise choices apply only the latest mode without stale rollback', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const browser = fakeCapture('mic-a');
  const off = fakeCapture('mic-a');
  off.capture.mode = 'off';
  let releaseFirstOpen = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirstOpen = () => resolve(browser.capture))))
    .mockResolvedValueOnce(off.capture);
  joinWith(first);
  roomDeviceUi.noiseMode = 'browser';
  const one = devices.switchNoiseMode();
  roomDeviceUi.noiseMode = 'off';
  const two = devices.switchNoiseMode();
  releaseFirstOpen();
  await Promise.all([one, two]);
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(off.capture.stream);
  expect(state.noiseMode).toBe('off');
  expect(showToast).not.toHaveBeenCalledWith('Не удалось переключить шумодав');
});

test('a stale acquisition rejection does not toast or roll back the newer device choice', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const latest = fakeCapture('mic-c');
  let rejectFirstOpen = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectFirstOpen = () => reject(new Error('stale'))))
    )
    .mockResolvedValueOnce(latest.capture);
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const one = devices.switchMicrophone();
  roomDeviceUi.microphoneId = 'mic-c';
  const two = devices.switchMicrophone();
  rejectFirstOpen();
  await expect(one).resolves.toBe(false);
  await expect(two).resolves.toBe(true);
  expect(state.localStream).toBe(latest.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(showToast).not.toHaveBeenCalledWith('Не удалось переключить микрофон');
});

test('failed newest queued device choice restores committed A, never superseded B', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-b');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockRejectedValueOnce(new Error('device C failed'));
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const one = devices.switchMicrophone();
  roomDeviceUi.microphoneId = 'mic-c';
  const two = devices.switchMicrophone();
  releaseFirst();
  await expect(one).resolves.toBe(false);
  await expect(two).resolves.toBe(false);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-a');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-a');
});

test('failed newest queued noise choice restores committed mode A, never superseded B', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-a');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockRejectedValueOnce(new Error('mode C failed'));
  state.noiseMode = 'rnnoise';
  joinWith(first);
  roomDeviceUi.noiseMode = 'browser';
  const one = devices.switchNoiseMode();
  roomDeviceUi.noiseMode = 'off';
  const two = devices.switchNoiseMode();
  releaseFirst();
  await Promise.all([one, two]);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.noiseMode).toBe('rnnoise');
  expect(roomDeviceUi.noiseMode).toBe('rnnoise');
  expect(localStorage.getItem('voice-room:noise-mode')).toBe('rnnoise');
});

test('successful noise choice commits a superseded device choice as the next rollback baseline', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-b');
  const committed = fakeCapture('mic-b');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockResolvedValueOnce(committed.capture)
    .mockRejectedValueOnce(new Error('device C failed'));
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const deviceB = devices.switchMicrophone();
  roomDeviceUi.noiseMode = 'browser';
  const noise = devices.switchNoiseMode();
  releaseFirst();
  await Promise.all([deviceB, noise]);
  expect(state.localStream).toBe(committed.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-b');
  roomDeviceUi.microphoneId = 'mic-c';
  expect(await devices.switchMicrophone()).toBe(false);
  expect(state.microphoneDeviceId).toBe('mic-b');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-b');
});

test('successful device choice commits a superseded noise choice as the next rollback baseline', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-a');
  const committed = fakeCapture('mic-b');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockResolvedValueOnce(committed.capture)
    .mockRejectedValueOnce(new Error('mode off failed'));
  state.noiseMode = 'rnnoise';
  joinWith(first);
  roomDeviceUi.noiseMode = 'browser';
  const noise = devices.switchNoiseMode();
  roomDeviceUi.microphoneId = 'mic-b';
  const deviceB = devices.switchMicrophone();
  releaseFirst();
  await Promise.all([noise, deviceB]);
  expect(state.localStream).toBe(committed.capture.stream);
  expect(state.noiseMode).toBe('browser');
  roomDeviceUi.noiseMode = 'off';
  await devices.switchNoiseMode();
  expect(state.noiseMode).toBe('browser');
  expect(localStorage.getItem('voice-room:noise-mode')).toBe('browser');
});

test('failed latest noise choice rolls back both superseded device and noise preferences', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-b');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockRejectedValueOnce(new Error('noise failed'));
  state.microphoneDeviceId = 'mic-a';
  state.noiseMode = 'rnnoise';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const deviceB = devices.switchMicrophone();
  roomDeviceUi.noiseMode = 'browser';
  const noise = devices.switchNoiseMode();
  releaseFirst();
  await Promise.all([deviceB, noise]);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-a');
  expect(state.noiseMode).toBe('rnnoise');
});

test('failed latest device choice rolls back both superseded noise and device preferences', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const superseded = fakeCapture('mic-a');
  let releaseFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = () => resolve(superseded.capture))))
    .mockRejectedValueOnce(new Error('device failed'));
  state.microphoneDeviceId = 'mic-a';
  state.noiseMode = 'rnnoise';
  joinWith(first);
  roomDeviceUi.noiseMode = 'browser';
  const noise = devices.switchNoiseMode();
  roomDeviceUi.microphoneId = 'mic-b';
  const deviceB = devices.switchMicrophone();
  releaseFirst();
  await Promise.all([noise, deviceB]);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-a');
  expect(state.noiseMode).toBe('rnnoise');
});

test('expired device intent behind a quarantined slot keeps the latest saved choice until a later real failure', async () => {
  vi.useFakeTimers();
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const late = fakeCapture('mic-b');
  let finishFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve(late.capture))))
    .mockRejectedValueOnce(new Error('device D failed'));
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const one = devices.switchMicrophone();
  roomDeviceUi.microphoneId = 'mic-c';
  const two = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(one).resolves.toBe(false);
  await expect(two).resolves.toBe(false);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-c');
  expect(showToast).not.toHaveBeenCalledWith('Не удалось переключить микрофон');
  finishFirst();
  await vi.advanceTimersByTimeAsync(0);
  roomDeviceUi.microphoneId = 'mic-d';
  expect(await devices.switchMicrophone()).toBe(false);
  expect(state.microphoneDeviceId).toBe('mic-a');
});

test('expired noise intent behind a quarantined slot keeps the latest saved choice until a later real failure', async () => {
  vi.useFakeTimers();
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const late = fakeCapture('mic-a');
  let finishFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve(late.capture))))
    .mockRejectedValueOnce(new Error('later mode failed'));
  state.noiseMode = 'rnnoise';
  joinWith(first);
  roomDeviceUi.noiseMode = 'browser';
  const one = devices.switchNoiseMode();
  roomDeviceUi.noiseMode = 'off';
  const two = devices.switchNoiseMode();
  await vi.advanceTimersByTimeAsync(20_000);
  await Promise.all([one, two]);
  expect(state.noiseMode).toBe('off');
  expect(localStorage.getItem('voice-room:noise-mode')).toBe('off');
  expect(showToast).not.toHaveBeenCalledWith('Не удалось переключить шумодав');
  finishFirst();
  await vi.advanceTimersByTimeAsync(0);
  roomDeviceUi.noiseMode = 'browser';
  await devices.switchNoiseMode();
  expect(state.noiseMode).toBe('rnnoise');
});

test('automatic commit after an expired device intent becomes the next manual rollback baseline', async () => {
  vi.useFakeTimers();
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const late = fakeCapture('mic-b');
  const committed = fakeCapture('mic-c');
  let finishFirst = () => {};
  open
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve(late.capture))))
    .mockResolvedValueOnce(committed.capture)
    .mockRejectedValueOnce(new Error('device D failed'));
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const one = devices.switchMicrophone();
  roomDeviceUi.microphoneId = 'mic-c';
  const two = devices.switchMicrophone();
  await vi.advanceTimersByTimeAsync(20_000);
  await Promise.all([one, two]);
  expect(state.microphoneDeviceId).toBe('mic-c');
  finishFirst();
  await vi.advanceTimersByTimeAsync(0);
  expect(await devices.reopenMicrophone()).toBe(true);
  expect(state.localStream).toBe(committed.capture.stream);
  roomDeviceUi.microphoneId = 'mic-d';
  expect(await devices.switchMicrophone()).toBe(false);
  expect(state.microphoneDeviceId).toBe('mic-c');
});

test('failed manual device settles A before latched RNNoise fallback acquires', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  first.capture.mode = 'rnnoise';
  const fallback = fakeCapture('mic-a');
  let rejectManual = () => {};
  const acquiredIds: string[] = [];
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockImplementationOnce(async () => {
      acquiredIds.push(state.microphoneDeviceId);
      return fallback.capture;
    });
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  devices.startMicrophoneCall();
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.capture.processorFailed = true;
  devices.fallbackRnnoiseAfterProcessorError(first.capture);
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.localStream).toBe(fallback.capture.stream));
  expect(acquiredIds).toEqual(['mic-a']);
  expect(state.microphoneDeviceId).toBe('mic-a');
  expect(localStorage.getItem('voice-room:microphone-device-id')).toBe('mic-a');
});

test('failed manual device and failed fallback leave old capture and confirmed A preference', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  first.capture.mode = 'rnnoise';
  let rejectManual = () => {};
  const fallbackIds: string[] = [];
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockImplementationOnce(() => {
      fallbackIds.push(state.microphoneDeviceId);
      return Promise.reject(new Error('fallback failed'));
    });
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  devices.startMicrophoneCall();
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.capture.processorFailed = true;
  devices.fallbackRnnoiseAfterProcessorError(first.capture);
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(fallbackIds).toEqual(['mic-a']);
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-a');
  devices.fallbackRnnoiseAfterProcessorError(first.capture);
  expect(open).toHaveBeenCalledTimes(2);
});

test('failed manual noise settles saved RNNoise before latched browser fallback starts', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  first.capture.mode = 'rnnoise';
  let rejectManual = () => {};
  const fallbackModes: string[] = [];
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('mode failed'))))
    )
    .mockImplementationOnce(() => {
      fallbackModes.push(state.noiseMode);
      return Promise.reject(new Error('fallback failed'));
    });
  state.noiseMode = 'rnnoise';
  joinWith(first);
  devices.startMicrophoneCall();
  roomDeviceUi.noiseMode = 'browser';
  const manual = devices.switchNoiseMode();
  first.capture.processorFailed = true;
  devices.fallbackRnnoiseAfterProcessorError(first.capture);
  rejectManual();
  await manual;
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(fallbackModes).toEqual(['rnnoise']);
  expect(state.noiseMode).toBe('rnnoise');
  expect(state.localStream).toBe(first.capture.stream);
});

test('newer queued noise intent runs before failed old-capture fallback after device rejection', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  first.capture.mode = 'rnnoise';
  const newest = fakeCapture('mic-b');
  let rejectManual = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockResolvedValueOnce(newest.capture);
  state.microphoneDeviceId = 'mic-a';
  state.noiseMode = 'rnnoise';
  joinWith(first);
  devices.startMicrophoneCall();
  roomDeviceUi.microphoneId = 'mic-b';
  const deviceB = devices.switchMicrophone();
  first.capture.processorFailed = true;
  devices.fallbackRnnoiseAfterProcessorError(first.capture);
  roomDeviceUi.noiseMode = 'browser';
  const noise = devices.switchNoiseMode();
  rejectManual();
  await Promise.all([deviceB, noise]);
  expect(state.localStream).toBe(newest.capture.stream);
  expect(state.noiseMode).toBe('browser');
  expect(open).toHaveBeenCalledTimes(2);
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
  const { state, open, stop, joinWith, unpublishTrack } = await load();
  const only = fakeCapture('usb-mic');
  open.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
  joinWith(only);

  only.unplug();
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));

  expect(state.joined).toBe(true);
  expect(state.localStream).toBeNull();
  expect(unpublishTrack).toHaveBeenCalledWith(microphonePublication.track, false);
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ stream: only.capture.stream }));
});

test('LocalTrackUnpublished before unpublish resolves still clears the same dead capture for explicit attach', async () => {
  const { state, devices, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const attached = fakeCapture('mic-b');
  joinWith(first);
  const publication = state.localMicPublication;
  expect(publication).not.toBeNull();
  if (!publication) return;
  let finishUnpublish = () => {};
  const unpublishTrack = vi.fn(async () => {
    room.emit(RoomEvent.LocalTrackUnpublished, publication, room.localParticipant);
    await new Promise<void>((resolve) => (finishUnpublish = resolve));
  });
  const room = Object.assign(new Room(), {
    localParticipant: { unpublishTrack, trackPublications: new Map<string, unknown>() }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (unpublished) => {
    if (state.livekitRoom === room && state.localMicPublication === unpublished) state.localMicPublication = null;
  });
  state.livekitRoom = room;
  state.muted = true;
  first.unplug();
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  expect(state.localMicPublication).toBeNull();
  finishUnpublish();
  await vi.waitFor(() => expect(state.localStream).toBeNull());
  open.mockResolvedValueOnce(attached.capture);
  await vi.waitFor(async () => expect(await devices.attachMicrophone()).toBe(true));
  expect(state.localStream).toBe(attached.capture.stream);
  expect(state.microphoneMissing).toBe(false);
});

test('late old unpublish cannot clear a different current publication and capture', async () => {
  const { state, stop, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const successor = fakeCapture('mic-b');
  joinWith(first);
  const publication = state.localMicPublication;
  expect(publication).not.toBeNull();
  if (!publication) return;
  let finishUnpublish = () => {};
  const unpublishTrack = vi.fn(async () => {
    room.emit(RoomEvent.LocalTrackUnpublished, publication, room.localParticipant);
    await new Promise<void>((resolve) => (finishUnpublish = resolve));
  });
  const room = Object.assign(new Room(), {
    localParticipant: { unpublishTrack, trackPublications: new Map<string, unknown>() }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (unpublished) => {
    if (state.livekitRoom === room && state.localMicPublication === unpublished) state.localMicPublication = null;
  });
  state.livekitRoom = room;
  state.muted = true;
  first.unplug();
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  const newerPublication = markRaw(Object.assign({}, publication));
  state.localMicPublication = newerPublication;
  microphone.setLocalMicrophoneCapture(successor.capture);
  state.microphoneMissing = false;
  finishUnpublish();
  await Promise.resolve();
  expect(state.localStream).toBe(successor.capture.stream);
  expect(state.localMicPublication).toBe(newerPublication);
  expect(state.microphoneMissing).toBe(false);
  expect(stop).not.toHaveBeenCalledWith(first.capture);
});

test('late old unpublish cannot clear a different publication on the same capture', async () => {
  const { state, stop, joinWith } = await load();
  const first = fakeCapture('mic-a');
  joinWith(first);
  const publication = state.localMicPublication;
  expect(publication).not.toBeNull();
  if (!publication) return;
  let finishUnpublish = () => {};
  const unpublishTrack = vi.fn(async () => {
    room.emit(RoomEvent.LocalTrackUnpublished, publication, room.localParticipant);
    await new Promise<void>((resolve) => (finishUnpublish = resolve));
  });
  const room = Object.assign(new Room(), {
    localParticipant: { unpublishTrack, trackPublications: new Map<string, unknown>() }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (unpublished) => {
    if (state.livekitRoom === room && state.localMicPublication === unpublished) state.localMicPublication = null;
  });
  state.livekitRoom = room;
  state.muted = true;
  first.unplug();
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  const newerPublication = markRaw(Object.assign({}, publication));
  state.localMicPublication = newerPublication;
  finishUnpublish();
  await Promise.resolve();
  expect(state.localStream).toBe(first.capture.stream);
  expect(state.localMicPublication).toBe(newerPublication);
  expect(stop).not.toHaveBeenCalledWith(first.capture);
});

test('raw-ended A is recovered after a busy manual B acquisition rejects', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const recovered = fakeCapture('mic-a');
  let rejectManual = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockResolvedValueOnce(recovered.capture);
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.localStream).toBe(recovered.capture.stream));
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.microphoneMissing).toBe(false);
  expect(state.microphoneDeviceId).toBe('mic-a');
});

test('failed bounded raw-loss recovery after busy B fails leaves honest listen-only state', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  let rejectManual = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockRejectedValueOnce(new Error('recovery failed'));
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBeNull();
  expect(state.joined).toBe(true);
});

test('raw-ended A is recovered after a busy manual B SDK replace rejects before attachment', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const candidate = fakeCapture('mic-b');
  const recovered = fakeCapture('mic-a');
  let rejectReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectReplace = () => reject(new Error('SDK failed'))))
  );
  open.mockResolvedValueOnce(candidate.capture).mockResolvedValueOnce(recovered.capture);
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  await vi.waitFor(() => expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledOnce());
  first.unplug();
  rejectReplace();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.localStream).toBe(recovered.capture.stream));
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.microphoneMissing).toBe(false);
});

test('healthy manual B successor discards a raw-ended A health latch', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const successor = fakeCapture('mic-b');
  let finishReplace = () => {};
  vi.mocked(publications.replaceLocalMicrophoneTrackForPublication).mockImplementationOnce(
    () => new Promise((resolve) => (finishReplace = () => resolve(true)))
  );
  open.mockResolvedValueOnce(successor.capture);
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  await vi.waitFor(() => expect(publications.replaceLocalMicrophoneTrackForPublication).toHaveBeenCalledOnce());
  first.unplug();
  finishReplace();
  expect(await manual).toBe(true);
  await Promise.resolve();
  expect(state.localStream).toBe(successor.capture.stream);
  expect(open).toHaveBeenCalledOnce();
  expect(state.microphoneMissing).toBe(false);
});

test('newer manual C wins over A raw-loss recovery after busy B fails', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const successor = fakeCapture('mic-c');
  let rejectManual = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockResolvedValueOnce(successor.capture);
  state.microphoneDeviceId = 'mic-a';
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const older = devices.switchMicrophone();
  first.unplug();
  roomDeviceUi.microphoneId = 'mic-c';
  const newer = devices.switchMicrophone();
  rejectManual();
  expect(await older).toBe(false);
  expect(await newer).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(state.localStream).toBe(successor.capture.stream);
  expect(state.microphoneDeviceId).toBe('mic-c');
  expect(state.microphoneMissing).toBe(false);
});

test('PTT-idle raw-loss recovery keeps the successor output disabled', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const recovered = fakeCapture('mic-a');
  let rejectManual = () => {};
  open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
    )
    .mockResolvedValueOnce(recovered.capture);
  joinWith(first);
  state.microphoneMode = 'push-to-talk';
  state.pushToTalkActive = false;
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.localStream).toBe(recovered.capture.stream));
  expect(recovered.published.enabled).toBe(false);
  expect(state.pushToTalkActive).toBe(false);
});

test('old raw-loss latch cannot alter a newer call after obsolete manual acquisition fails', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  const newerCall = fakeCapture('mic-new');
  let rejectManual = () => {};
  open.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('old B failed'))))
  );
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const obsolete = devices.switchMicrophone();
  first.unplug();
  devices.invalidateMicrophoneActions();
  Object.assign(state, createInitialRoomState());
  joinWith(newerCall);
  devices.startMicrophoneCall();
  rejectManual();
  expect(await obsolete).toBe(false);
  await Promise.resolve();
  expect(open).toHaveBeenCalledOnce();
  expect(state.localStream).toBe(newerCall.capture.stream);
  expect(state.microphoneMissing).toBe(false);
});

test('muted raw-ended A becomes honestly unavailable after busy B fails without new capture permission', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  let rejectManual = () => {};
  open.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
  );
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  state.muted = true;
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));
  expect(open).toHaveBeenCalledOnce();
  expect(state.localStream).toBeNull();
  expect(state.muted).toBe(true);
});

test('deafened raw-ended A becomes unavailable without an unsolicited capture or unmute', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  let rejectManual = () => {};
  open.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
  );
  joinWith(first);
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  state.outputMuted = true;
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));
  expect(open).toHaveBeenCalledOnce();
  expect(state.localStream).toBeNull();
  expect(state.outputMuted).toBe(true);
});

test('exhausted automatic budget detaches a raw-ended A after busy B fails without a seventh request', async () => {
  const { state, devices, roomDeviceUi, open, joinWith } = await load();
  const first = fakeCapture('mic-a');
  joinWith(first);
  devices.startMicrophoneCall();
  open.mockRejectedValue(new Error('reopen failed'));
  for (let index = 0; index < 6; index += 1) expect(await devices.reopenMicrophone()).toBe(false);
  expect(open).toHaveBeenCalledTimes(6);
  let rejectManual = () => {};
  open.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectManual = () => reject(new Error('B failed'))))
  );
  roomDeviceUi.microphoneId = 'mic-b';
  const manual = devices.switchMicrophone();
  first.unplug();
  rejectManual();
  expect(await manual).toBe(false);
  await vi.waitFor(() => expect(state.microphoneMissing).toBe(true));
  expect(open).toHaveBeenCalledTimes(7);
  expect(state.localStream).toBeNull();
});

test('in the call without a microphone, plugging one in adds it muted', async () => {
  vi.useFakeTimers();
  const { state, devices, open } = await load();
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
  expect(publications.publishLocalMicrophoneForRoom).toHaveBeenCalledTimes(1);
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
