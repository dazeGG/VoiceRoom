import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { NativeVoiceBridge, NativeVoiceEvent } from '@voiceroom/call/engine/desktop-capabilities';
import type { NativeVoiceAdmission } from '@voiceroom/shared/contracts/admission';
import { fakeParticipant, fakePublication, loadLiveKitHarness } from '../helpers/livekit-harness';
import { defined } from '../helpers/assert';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';

const capability = { version: 1, stage: 'receive', generation: 'a'.repeat(32) } as const;
const ROOM_ID = 'voice-room';
const SESSION_TOKEN = 'session-token';
const flush = () => vi.advanceTimersByTimeAsync(0);
type UpdateResult = Awaited<ReturnType<NativeVoiceBridge['update']>>;

function stubVoicePlayback() {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const node = () => ({ connect() {}, disconnect() {} });
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = node();
    createGain() {
      return { ...node(), gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} } };
    }
    createDynamicsCompressor() {
      return { ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} };
    }
    createMediaStreamSource = node;
    createAnalyser() {
      return { ...node(), frequencyBinCount: 0 };
    }
    async resume() {}
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
}

type BridgeEvent = NativeVoiceEvent extends infer Event
  ? Event extends { callId: string }
    ? Omit<Event, 'callId'>
    : never
  : never;

function desktopBridge(minor: number) {
  const listeners = new Set<(event: NativeVoiceEvent) => void>();
  const bridge = {
    getCapability: vi.fn<NativeVoiceBridge['getCapability']>(async () => ({
      available: true,
      protocol: { major: 1, minor }
    })),
    listOutputs: vi.fn<NativeVoiceBridge['listOutputs']>(async () => []),
    start: vi.fn<NativeVoiceBridge['start']>(async () => ({ ok: true })),
    update: vi.fn<NativeVoiceBridge['update']>(async () => ({ ok: true })),
    stop: vi.fn<NativeVoiceBridge['stop']>(async () => {}),
    onEvent: vi.fn<NativeVoiceBridge['onEvent']>((handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    })
  } satisfies NativeVoiceBridge;
  const emit = (event: BridgeEvent, callId = defined(bridge.start.mock.lastCall, 'helper start')[0].callId) => {
    for (const listener of listeners) listener({ ...event, callId });
  };
  const stats = (totalSamplesReceived: number, fields: Partial<Extract<BridgeEvent, { kind: 'stats' }>> = {}) =>
    emit({
      kind: 'stats',
      at: Date.now(),
      totalSamplesReceived,
      jitterBufferDelaySeconds: 0,
      jitterBufferEmittedCount: totalSamplesReceived,
      concealedSamples: 0,
      concealmentEvents: 0,
      packetsLost: 0,
      rttSeconds: null,
      ...fields
    });
  return { bridge, emit, stats };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadReceive(minor = 0) {
  vi.useFakeTimers();
  stubVoicePlayback();
  const desktop = desktopBridge(minor);
  const mediaStreamTrack = new FakeMediaStreamTrack('browser-mic', 'audio');
  const track = { mediaStreamTrack, mediaStream: new MediaStream([mediaStreamTrack]) };
  const microphone = fakePublication('microphone', { trackSid: 'mic-original', track, isSubscribed: true });
  const screenAudio = fakePublication('screen-audio');
  const remote = fakeParticipant('peer-remote', [microphone.publication, screenAudio.publication]);
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    realVoicePlayback: true,
    stubPresence: true,
    onConnect(room) {
      room.remoteParticipants.set(remote.identity, remote);
    }
  });
  const { getCallPorts } = await import('@voiceroom/call/engine/ports');
  const ports = getCallPorts();
  const preferences = new Map<string, string>();
  ports.storage = {
    read: (key) => preferences.get(key) ?? null,
    write: (key, value) => preferences.set(key, value),
    remove: (key) => preferences.delete(key)
  };
  const identity = vi.spyOn(ports.identity, 'current').mockReturnValue({ kind: 'account', profile: null });
  const admission: NativeVoiceAdmission = {
    ok: true,
    version: 1,
    generation: capability.generation,
    identity: `self#voice.${'c'.repeat(32)}`,
    expiresAt: Date.now() + 60_000,
    room: 'media-room',
    token: 'private-companion-token',
    ttlSeconds: 60,
    url: 'wss://admission.invalid'
  };
  const admit = vi.spyOn(ports.transport, 'requestNativeVoiceAdmission').mockResolvedValue(admission);
  const logger = { ...ports.diagnostics.logger('test'), info: vi.fn(), warn: vi.fn() };
  vi.spyOn(ports.diagnostics, 'logger').mockReturnValue(logger);
  vi.stubGlobal('voiceRoomDesktopNativeVoice', desktop.bridge);
  Object.assign(lk.state, {
    roomId: ROOM_ID,
    sessionToken: SESSION_TOKEN,
    outputDeviceId: '',
    localAppAudioSuppressed: false,
    viewedScreenPeerId: remote.identity,
    localNetwork: {},
    localScreenPublications: new Map<string, unknown>()
  });
  expect(await lk.service.connectLiveKitRoom('Local')).toBe(true);
  lk.state.joined = true;
  onTestFinished(async () => {
    await lk.service.disconnectLiveKitRoom();
    for (const peer of lk.state.peers.values()) {
      for (const audio of peer.audioElements?.values() ?? []) audio.remove();
    }
  });
  const receiver = await import('@voiceroom/call/engine/services/native-voice-receive');
  const settings = await import('@voiceroom/call/engine/core/settings');
  const bus = await import('@voiceroom/call/engine/services/audio-bus');
  const { toggleOutputMute } = await import('@voiceroom/call/engine/ui/controls');
  const room = defined(lk.rooms[0], 'browser room');
  room.emit('TrackSubscribed', track, microphone.publication, remote);
  await flush();
  const peer = defined(lk.state.peers.get(remote.identity), 'remote peer');
  const elements = defined(peer.audioElements, 'remote voice elements');
  const start = async () => {
    receiver.setNativeVoiceCapability(capability);
    await flush();
    if (desktop.bridge.start.mock.calls.length === 1) desktop.emit({ kind: 'transport', state: 'connected' });
  };
  const probe = async () => {
    desktop.emit({ kind: 'media-ready' });
    desktop.stats(0);
    desktop.stats(24_000);
    await flush();
  };
  const confirm = async () => {
    await vi.advanceTimersByTimeAsync(1_000);
    desktop.stats(48_000);
    await vi.advanceTimersByTimeAsync(100);
  };
  const activate = async () => {
    await start();
    await probe();
    await confirm();
    expect(desktop.bridge.start.mock.lastCall?.[0].tracks).toEqual(['mic-original']);
    expect(receiver.isNativeVoiceReceiving()).toBe(true);
    expect(microphone.calls.enabled).toEqual([false]);
  };
  return {
    ...desktop,
    ...lk,
    admission,
    admit,
    activate,
    probe,
    confirm,
    bus,
    elements,
    identity,
    logger,
    microphone,
    peer,
    ports,
    receiver,
    remote,
    room,
    screenAudio,
    settings,
    start,
    toggleOutputMute
  };
}

test('handoff waits for unmute and confirms growth before removing Chromium microphone elements and meters', async () => {
  const call = await loadReceive();
  const { elements, peer } = call;
  const audio = defined(elements.get('browser-mic'), 'browser microphone element');
  const meter = defined(peer.meter, 'browser microphone meter');
  const unmute = Promise.withResolvers<UpdateResult>();
  call.bridge.update.mockReturnValueOnce(unmute.promise);
  await call.start();
  expect(call.admit).toHaveBeenCalledWith({
    version: 1,
    roomId: 'voice-room',
    peerId: 'self',
    sessionToken: 'session-token',
    generation: capability.generation
  });
  const start = defined(call.bridge.start.mock.lastCall, 'helper start')[0];
  expect(start.callId).toBeTruthy();
  expect(start).toEqual({
    callId: start.callId,
    tracks: ['mic-original'],
    outputDeviceId: null,
    muted: true,
    url: call.admission.url,
    token: call.admission.token
  });
  call.emit({ kind: 'media-ready' }, 'old-call');
  call.stats(0);
  await flush();
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.microphone.calls.enabled).toEqual([]);
  call.emit({ kind: 'media-ready' });
  await flush();
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(elements.size).toBe(1);
  call.stats(960);
  await flush();
  expect(call.bridge.update).toHaveBeenCalledWith({ callId: start.callId, muted: false });
  expect(audio.muted).toBe(false);
  expect(peer.meter).toBe(meter);
  expect(call.microphone.calls.enabled).toEqual([]);
  call.stats(1_920); // A sample before the acknowledgment cannot confirm playout.
  unmute.resolve({ ok: true });
  await flush();
  expect(audio.muted).toBe(true);
  expect(elements.get('browser-mic')).toBe(audio);
  expect(peer.meter).toBe(meter);
  expect(call.microphone.calls.enabled).toEqual([]);
  await vi.advanceTimersByTimeAsync(1_000);
  call.stats(2_880);
  expect(call.microphone.calls.enabled).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.microphone.calls.enabled).toEqual([false]);
  expect(call.screenAudio.calls.subscribed).toEqual([true]);
  expect(call.screenAudio.calls.enabled).toEqual([]);
  expect(elements.size).toBe(0);
  expect(peer.meter).toBeNull();
});

test('only eligible canonical remote mic SIDs follow publish, republish, mute, join and leave', async () => {
  const call = await loadReceive();
  const self = fakeParticipant('self', [fakePublication('microphone', { trackSid: 'mic-self' }).publication]);
  call.syncParticipant(self);
  const hidden = fakeParticipant(call.admission.identity, [
    fakePublication('microphone', { trackSid: 'mic-hidden' }).publication
  ]);
  call.syncParticipant(hidden);
  await call.activate();
  expect(call.bridge.start.mock.lastCall?.[0].tracks).toEqual(['mic-original']);

  const second = fakePublication('microphone', { trackSid: 'mic-second' });
  const newPeer = fakeParticipant('peer-second', [second.publication]);
  call.room.remoteParticipants.set(newPeer.identity, newPeer);
  call.room.emit('ParticipantConnected', newPeer);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-original', 'mic-second']);
  expect(second.calls.subscribed).toEqual([true]);
  expect(second.calls.enabled).toEqual([false]);

  second.publication.isMuted = true;
  call.room.emit('TrackMuted', second.publication, newPeer);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-original']);
  second.publication.isMuted = false;
  call.room.emit('TrackUnmuted', second.publication, newPeer);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-original', 'mic-second']);

  call.remote.trackPublications.delete(call.microphone.publication.trackSid);
  call.room.emit('TrackUnpublished', call.microphone.publication, call.remote);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-second']);
  const replacement = fakePublication('microphone', { trackSid: 'mic-republished' });
  call.remote.trackPublications.set(replacement.publication.trackSid, replacement.publication);
  call.room.emit('TrackPublished', replacement.publication, call.remote);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-republished', 'mic-second']);

  call.room.remoteParticipants.delete(newPeer.identity);
  call.room.emit('ParticipantDisconnected', newPeer);
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual(['mic-republished']);
  call.settings.storeParticipantAudioPreference('peer:peer-remote', { muted: true });
  call.receiver.syncNativeVoiceReceive();
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].tracks).toEqual([]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(call.bridge.stop).not.toHaveBeenCalled();
});

test('emitted samples qualify the handoff even if the SDK leaves received samples at zero', async () => {
  const call = await loadReceive();
  await call.start();
  call.stats(0);
  call.stats(0, { jitterBufferEmittedCount: 960 });
  await flush();
  expect(call.microphone.calls.enabled).toEqual([]);
  call.emit({ kind: 'media-ready' });
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].muted).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  call.stats(0, { jitterBufferEmittedCount: 1_920 });
  await vi.advanceTimersByTimeAsync(100);
  expect(call.microphone.calls.enabled).toEqual([false]);
});

test.each(['disconnected', 'reconnecting'] as const)(
  'a %s transport before start acknowledgment invalidates the entire probe',
  async (state) => {
    const call = await loadReceive();
    const starting = Promise.withResolvers<UpdateResult>();
    call.bridge.start.mockReturnValueOnce(starting.promise);
    await call.start();
    await call.probe();
    call.emit({ kind: 'transport', state });
    call.emit({ kind: 'media-ready' });
    call.stats(36_000);
    starting.resolve({ ok: true });
    await flush();
    expect(call.bridge.update).not.toHaveBeenCalled();
    expect(call.elements.get('browser-mic')?.muted).toBe(false);

    call.emit({ kind: 'transport', state: 'connected' });
    call.emit({ kind: 'media-ready' });
    call.stats(36_000);
    await flush();
    expect(call.bridge.update).not.toHaveBeenCalled();
    call.stats(48_000);
    await flush();
    expect(call.bridge.update.mock.lastCall?.[0].muted).toBe(false);
  }
);

test.each(['refusal', 'timeout'] as const)(
  'native unmute %s leaves Chromium audible and falls back',
  async (failure) => {
    const call = await loadReceive();
    const unmute = Promise.withResolvers<UpdateResult>();
    call.bridge.update.mockReturnValueOnce(unmute.promise);
    await call.start();
    await call.probe();
    const audio = defined(call.elements.get('browser-mic'), 'browser microphone element');
    if (failure === 'refusal') unmute.resolve({ ok: false, code: 'device_error' });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(audio.muted).toBe(false);
    expect(call.microphone.calls.enabled).toEqual([]);
    expect(call.bridge.stop).toHaveBeenCalledTimes(1);
    await call.start();
    expect(call.admit).toHaveBeenCalledTimes(1);
  }
);

test.each([false, true])(
  'stalled confirmation restores browser audio before stop even with earlier growth (%s)',
  async (grew) => {
    const call = await loadReceive();
    const stopping = Promise.withResolvers<void>();
    call.bridge.stop.mockReturnValueOnce(stopping.promise);
    const audio = defined(call.elements.get('browser-mic'), 'browser microphone element');
    const meter = defined(call.peer.meter, 'browser microphone meter');
    await call.start();
    await call.probe();
    expect(audio.muted).toBe(true);
    const samples = grew ? 36_000 : 24_000;
    await vi.advanceTimersByTimeAsync(500);
    call.stats(samples);
    await vi.advanceTimersByTimeAsync(500);
    call.stats(samples);
    await vi.advanceTimersByTimeAsync(100);
    expect(call.bridge.stop).toHaveBeenCalledTimes(1);
    expect(call.elements.get('browser-mic')).toBe(audio);
    expect(audio.muted).toBe(false);
    expect(call.peer.meter).toBe(meter);
    expect(call.microphone.calls.enabled).toEqual([]);
    await call.start();
    expect(call.admit).toHaveBeenCalledTimes(1);
    stopping.resolve();
  }
);

test('transport loss during confirmation restores browser playback without waiting for the confirmation timer', async () => {
  const call = await loadReceive();
  const audio = defined(call.elements.get('browser-mic'), 'browser microphone element');
  await call.start();
  await call.probe();
  expect(audio.muted).toBe(true);
  call.emit({ kind: 'transport', state: 'reconnecting' });
  expect(audio.muted).toBe(false);
  expect(call.bridge.stop).toHaveBeenCalledTimes(1);
  expect(call.microphone.calls.enabled).toEqual([]);
});

test('deafen sends helper mute while a device switch is waiting and the device update preserves mute', async () => {
  const call = await loadReceive();
  await call.activate();
  const device = { kind: 'audiooutput', deviceId: 'browser-id', label: 'Headset (USB)' };
  const outputs = Promise.withResolvers<Awaited<ReturnType<NativeVoiceBridge['listOutputs']>>>();
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => [device] } });
  call.bridge.listOutputs.mockReturnValueOnce(outputs.promise);
  const switchOutput = call.bus.setOutputDevice(device.deviceId);
  expect(call.bridge.listOutputs).toHaveBeenCalledTimes(1);
  call.toggleOutputMute();
  const { callId } = defined(call.bridge.start.mock.lastCall, 'helper start')[0];
  expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, muted: true });
  outputs.resolve([{ id: 'wasapi-id', name: device.label, isDefault: false }]);
  await switchOutput;
  await flush();
  expect(call.bridge.update.mock.calls.map(([change]) => change)).toEqual([
    { callId, muted: false },
    { callId, muted: true },
    { callId, outputDeviceId: 'wasapi-id' }
  ]);
  expect(call.receiver.isNativeVoiceReceiving()).toBe(true);
});

test('deafen preempts an in-flight unmute and a late acknowledgment cannot take over browser playback', async () => {
  const call = await loadReceive();
  const audio = defined(call.elements.get('browser-mic'), 'browser microphone element');
  const unmute = Promise.withResolvers<UpdateResult>();
  call.bridge.update.mockReturnValueOnce(unmute.promise);
  await call.start();
  await call.probe();
  const { callId } = defined(call.bridge.start.mock.lastCall, 'helper start')[0];
  expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, muted: false });
  call.toggleOutputMute();
  expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, muted: true });
  expect(call.bridge.stop).toHaveBeenCalledWith({ callId });
  unmute.resolve({ ok: true });
  await call.confirm();
  expect(call.bridge.update).toHaveBeenCalledTimes(2);
  expect(call.microphone.calls.enabled).toEqual([]);
  expect(call.elements.get('browser-mic')).toBe(audio);
  expect(audio.muted).toBe(true);
  call.toggleOutputMute();
  expect(audio.muted).toBe(false);
});

test('native handoff and undeafen seed canonical speaking rings without another LiveKit speaker event', async () => {
  const call = await loadReceive();
  const { peer } = call;
  const self = { id: 'self', speaking: false };
  call.state.self = self;
  call.state.peers.set(self.id, self);
  const identity = `${peer.id}#voice.${'b'.repeat(32)}`;
  call.receiver.setNativeVoiceCompanions({ version: 1, companions: [{ identity, peerId: peer.id }] });
  call.room.activeSpeakers = [{ identity }, { identity: self.id }];
  call.room.emit('ActiveSpeakersChanged', call.room.activeSpeakers);
  await call.activate();
  expect(peer.speaking).toBe(true);
  expect(self.speaking).toBe(false);
  call.toggleOutputMute();
  await flush();
  expect(peer.speaking).toBe(false);
  expect(call.bridge.update.mock.lastCall?.[0].muted).toBe(true);
  call.toggleOutputMute();
  await flush();
  expect(peer.speaking).toBe(true);
  expect(call.bridge.update.mock.lastCall?.[0].muted).toBe(false);
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.microphone.calls.enabled).toEqual([false]);
});

test.each(['off', 'internal-join', 'missing-bridge', 'guest'] as const)(
  '%s leaves Chromium subscribed and skips companion admission',
  async (condition) => {
    const call = await loadReceive();
    if (condition === 'missing-bridge') vi.stubGlobal('voiceRoomDesktopNativeVoice', undefined);
    if (condition === 'guest') {
      call.identity.mockReturnValue({ kind: 'guest', profile: null });
    }
    call.receiver.setNativeVoiceCapability({
      ...capability,
      stage: condition === 'off' || condition === 'internal-join' ? condition : 'receive'
    });
    await flush();
    expect(call.admit).not.toHaveBeenCalled();
    expect(call.bridge.getCapability).not.toHaveBeenCalled();
    expect(call.microphone.calls.subscribed).toEqual([true]);
    expect(call.microphone.calls.enabled).toEqual([]);
  }
);

type FallbackTrigger = (call: Awaited<ReturnType<typeof loadReceive>>) => void | Promise<void>;
const fallbackCases: Array<[string, FallbackTrigger]> = [
  ['helper_fault', (call) => call.emit({ kind: 'fault', code: 'endpoint_lost' })],
  ['helper_stopped', (call) => call.emit({ kind: 'stopped' })],
  [
    'transport_disconnected',
    async (call) => {
      call.emit({ kind: 'transport', state: 'disconnected' });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(call.bridge.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
    }
  ],
  [
    'stats_stalled',
    async (call) => {
      await vi.advanceTimersByTimeAsync(3_900);
      call.stats(48_000);
      expect(call.bridge.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
    }
  ],
  ['admission_revoked', (call) => call.receiver.setNativeVoiceCapability({ ...capability, stage: 'off' })],
  [
    'unsupported_volume',
    (call) => {
      call.settings.persistMasterVolume(80);
      call.bus.syncAudioBusSettings();
    }
  ],
  [
    'unsupported_volume',
    (call) => {
      call.settings.storeParticipantAudioPreference('peer:peer-remote', { volume: 1.5 });
      call.receiver.syncNativeVoiceReceive();
    }
  ],
  [
    'unsupported_output',
    (call) => {
      call.state.outputDeviceId = 'missing';
      call.receiver.syncNativeVoiceReceive({ devicesChanged: true });
    }
  ]
];
test.each(fallbackCases)('%s restores only browser voices and remains sticky', async (reason, trigger) => {
  const call = await loadReceive();
  await call.activate();
  const triggered = trigger(call);
  if (triggered) await triggered;
  await flush();
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.screenAudio.calls.subscribed).toEqual([true]);
  expect(call.bridge.stop).toHaveBeenCalledWith({ callId: call.bridge.start.mock.lastCall?.[0].callId });
  expect(call.logger.warn).toHaveBeenCalledWith('native receive fallback', expect.objectContaining({ reason }));
  await call.start();
  expect(call.admit).toHaveBeenCalledTimes(1);
});

test('expiry keeps the same call and restores browser audio even with healthy media', async () => {
  const call = await loadReceive();
  call.admit.mockResolvedValue({ ...call.admission, expiresAt: Date.now() + 2_000 });
  await call.activate();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(call.logger.warn).toHaveBeenCalledWith('native receive fallback', { reason: 'admission_expired' });
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.room.disconnected).toBe(false);
});

test('realtime policy revocation stops only the current helper and restores Chromium within its stop timeout', async () => {
  const call = await loadReceive(2);
  await call.activate();
  call.bridge.stop.mockReturnValueOnce(new Promise(() => {}));
  const { createVoiceEventHandler } = await import('@voiceroom/call/engine/room/voice-events');
  const { mapWebCallEvent } = await import('@/features/room/adapters/web-call-transport');
  const handle = createVoiceEventHandler({ leaveRoom: vi.fn(), showModeration: vi.fn(), showNotFound: vi.fn() });
  const dispatch = async (roomId: string, generation: string) =>
    handle(
      defined(
        mapWebCallEvent({
          type: 'room.native_voice.updated',
          payload: { roomId, version: 1, stage: 'off', generation }
        }),
        'mapped native voice policy update'
      )
    );

  await dispatch('another-room', capability.generation);
  await dispatch(ROOM_ID, 'b'.repeat(32));
  expect(call.bridge.stop).not.toHaveBeenCalled();
  await dispatch(ROOM_ID, capability.generation);
  await flush();
  expect(call.bridge.stop).toHaveBeenCalledExactlyOnceWith({ callId: call.bridge.start.mock.lastCall?.[0].callId });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.receiver.isNativeVoiceReceiving()).toBe(false);
  expect(call.receiver.nativeVoiceTelemetryForReport()?.fallback).toBe('admission_revoked');
  expect(call.room.disconnected).toBe(false);
});

test('renews each 20 seconds through the original expiry and falls back once renewal is refused', async () => {
  const call = await loadReceive(2);
  const leaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  call.admit.mockResolvedValue({ ...call.admission, leaseId });
  const renew = vi.spyOn(call.ports.transport, 'renewNativeVoiceLease').mockImplementation(async () => ({
    ok: true,
    version: 1,
    leaseId,
    expiresAt: Date.now() + 60_000,
    token: 'refreshed-companion-token'
  }));
  await call.activate();
  let samples = 48_000;
  const play = async (ms: number) => {
    while (ms > 0) {
      const elapsed = Math.min(ms, 1_000);
      await vi.advanceTimersByTimeAsync(elapsed);
      samples += elapsed * 48;
      call.stats(samples);
      ms -= elapsed;
    }
  };
  await play(18_899);
  expect(renew).not.toHaveBeenCalled();
  await play(1);
  expect(renew).toHaveBeenCalledExactlyOnceWith(
    { ...defined(call.admit.mock.lastCall, 'original roster binding')[0], leaseId },
    expect.any(AbortSignal)
  );
  await play(45_000);
  expect(renew).toHaveBeenCalledTimes(3);
  expect(call.receiver.isNativeVoiceReceiving()).toBe(true);
  expect(call.bridge.start).toHaveBeenCalledTimes(1);
  expect(call.bridge.update).toHaveBeenCalledExactlyOnceWith({
    callId: call.bridge.start.mock.lastCall?.[0].callId,
    muted: false
  });

  renew.mockRejectedValue(new Error('Forbidden'));
  await play(15_000);
  expect(call.logger.warn).toHaveBeenCalledWith('native receive fallback', { reason: 'admission_refused' });
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.screenAudio.calls.subscribed).toEqual([true]);
  expect(call.bridge.stop).toHaveBeenCalledTimes(1);
  expect(call.room.disconnected).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(renew).toHaveBeenCalledTimes(4);
});

test('leaving cancels an in-flight renewal and ignores its late response', async () => {
  const call = await loadReceive(2);
  const leaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  call.admit.mockResolvedValue({ ...call.admission, leaseId });
  const renew = vi.spyOn(call.ports.transport, 'renewNativeVoiceLease');
  const response = Promise.withResolvers<Awaited<ReturnType<typeof renew>>>();
  renew.mockReturnValue(response.promise);
  await call.start();
  // An empty native probe has no media stats timer, and still owns its admission.
  call.microphone.publication.isMuted = true;
  call.receiver.syncNativeVoiceReceive();
  await vi.advanceTimersByTimeAsync(20_000);
  const [, signal] = defined(renew.mock.lastCall, 'in-flight renewal');
  call.receiver.resetNativeVoiceReceive();
  expect(signal.aborted).toBe(true);
  response.resolve({ ok: true, version: 1, leaseId, expiresAt: Date.now() + 60_000, token: 'renewed' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(call.logger.warn).not.toHaveBeenCalledWith('native receive fallback', expect.anything());
});

test('a recovering helper can resume before the disconnect deadline', async () => {
  const call = await loadReceive();
  await call.activate();
  call.emit({ kind: 'transport', state: 'disconnected' });
  await vi.advanceTimersByTimeAsync(2_500);
  call.emit({ kind: 'transport', state: 'connected' });
  call.stats(50_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(call.bridge.stop).not.toHaveBeenCalled();
  expect(call.microphone.calls.enabled).toEqual([false]);
});

test('an unsupported device restores browser forwarding after the helper stops', async () => {
  const call = await loadReceive();
  await call.activate();
  const stopping = Promise.withResolvers<void>();
  call.bridge.stop.mockReturnValue(stopping.promise);
  call.emit({ kind: 'device', outputDeviceId: 'selected', effectiveOutputDeviceId: null, muted: false });
  await flush();
  expect(call.bridge.stop).toHaveBeenCalledTimes(1);
  expect(call.microphone.calls.enabled).toEqual([false]);
  expect(call.elements.size).toBe(0);
  expect(call.peer.meter).toBeNull();
  stopping.resolve();
  await flush();
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.elements.get('browser-mic')?.muted).toBe(false);
  expect(call.peer.meter).toBeTruthy();
  expect(call.logger.warn).toHaveBeenCalledWith('native receive fallback', { reason: 'unsupported_output' });
});

test('fallback while deafened restores the browser microphone element and meter on undeafen', async () => {
  const call = await loadReceive();
  await call.activate();
  call.toggleOutputMute();
  call.emit({ kind: 'fault', code: 'device_lost' });
  await flush();
  expect(call.elements.size).toBe(0);
  expect(call.peer.meter).toBeNull();
  call.toggleOutputMute();
  expect(call.elements.get('browser-mic')?.muted).toBe(false);
  expect(call.peer.meter).toBeTruthy();
  expect(call.bridge.update.mock.lastCall?.[0].muted).toBe(true);
});

test('refused admission does not touch subscriptions or send credentials to the helper', async () => {
  const call = await loadReceive();
  call.admit.mockRejectedValue(new Error('refused'));
  await call.start();
  expect(call.bridge.start).not.toHaveBeenCalled();
  expect(call.microphone.calls.subscribed).toEqual([true]);
  expect(call.logger.warn).toHaveBeenCalledWith('native receive fallback', { reason: 'admission_refused' });
  await call.start();
  expect(call.admit).toHaveBeenCalledTimes(1);
});

test('explicit output selection maps the browser label to a WASAPI endpoint', async () => {
  const call = await loadReceive();
  const device = { kind: 'audiooutput', deviceId: 'browser-id', label: 'Headset (USB)' };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => [device] }
  });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });
  call.bridge.listOutputs.mockResolvedValue([{ id: 'wasapi-id', name: ' Headset (USB) ', isDefault: false }]);
  call.state.outputDeviceId = device.deviceId;
  await call.start();
  expect(call.bridge.start.mock.lastCall?.[0].outputDeviceId).toBe('wasapi-id');
});

test.each([2, 3])(
  'bridge 1.%i applies start gains, zero, resets to unity and per-person mute independently',
  async (minor) => {
    const call = await loadReceive(minor);
    call.settings.persistMasterVolume(200);
    call.settings.storeParticipantAudioPreference('peer:peer-remote', { volume: 1.5 });
    await call.activate();
    expect(call.bridge.start.mock.lastCall?.[0]).toMatchObject({ volumes: { 'mic-original': 1.5 }, masterVolume: 2 });

    call.settings.storeParticipantAudioPreference('peer:peer-remote', { volume: 0 });
    call.settings.persistMasterVolume(0);
    call.bus.syncAudioBusSettings();
    await flush();
    const callId = call.bridge.start.mock.lastCall?.[0].callId;
    expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, volumes: { 'mic-original': 0 }, masterVolume: 0 });

    call.settings.storeParticipantAudioPreference('peer:peer-remote', { muted: true });
    call.receiver.syncNativeVoiceReceive();
    await flush();
    expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, tracks: [], volumes: {} });

    call.settings.storeParticipantAudioPreference('peer:peer-remote', { muted: false, volume: 1 });
    call.settings.persistMasterVolume(100);
    call.bus.syncAudioBusSettings();
    await flush();
    expect(call.bridge.update.mock.lastCall?.[0]).toEqual({ callId, tracks: ['mic-original'], masterVolume: 1 });
    expect(call.receiver.isNativeVoiceReceiving()).toBe(true);
    expect(call.bridge.stop).not.toHaveBeenCalled();
  }
);

test.each([0, 1])('bridge 1.%i only receives legacy fields and falls back for changed gains', async (minor) => {
  const call = await loadReceive(minor);
  await call.activate();
  expect(call.bridge.start.mock.lastCall?.[0]).not.toHaveProperty('volumes');
  expect(call.bridge.start.mock.lastCall?.[0]).not.toHaveProperty('masterVolume');
  call.settings.persistMasterVolume(150);
  call.bus.syncAudioBusSettings();
  await flush();
  expect(call.receiver.nativeVoiceTelemetryForReport()).toEqual({
    started: true,
    handedOff: true,
    fallback: 'unsupported_volume'
  });
  expect(call.bridge.stop).toHaveBeenCalledOnce();
});

test('the 1.2 gain map respects its 128-SID limit without dropping any custom gains', async () => {
  const call = await loadReceive(2);
  call.settings.storeParticipantAudioPreference('peer:peer-remote', { volume: 1.5 });
  function addMic(index: number): void {
    const trackSid = `TR_test_${index}`;
    call.remote.trackPublications.set(trackSid, fakePublication('microphone', { trackSid }).publication);
  }
  for (let index = 1; index < 128; index += 1) addMic(index);
  await call.start();
  expect(Object.keys(call.bridge.start.mock.lastCall?.[0].volumes ?? {})).toHaveLength(128);

  addMic(128);
  call.receiver.syncNativeVoiceReceive();
  await flush();
  expect(call.bridge.update).not.toHaveBeenCalled();
  expect(call.bridge.stop).toHaveBeenCalledOnce();
  expect(call.receiver.nativeVoiceTelemetryForReport()?.fallback).toBe('track_volume_limit');
});

test('bridge 1.2 keeps a preferred endpoint through unplug, the default change and restoration', async () => {
  const call = await loadReceive(2);
  const device = { kind: 'audiooutput', deviceId: 'browser-id', label: 'Headset' };
  const endpoint = { id: 'wasapi-id', name: ' Headset ', isDefault: false };
  const enumerateDevices = vi.fn(async () => [device]);
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } });
  call.bridge.listOutputs.mockResolvedValue([endpoint]);
  call.state.outputDeviceId = device.deviceId;
  await call.activate();
  expect(call.bridge.start.mock.lastCall?.[0].outputDeviceId).toBe(endpoint.id);
  call.logger.info.mockClear();
  const deviceEvent = (effectiveOutputDeviceId: string, defaultOutputDeviceId: string, missing: boolean) =>
    call.emit({
      kind: 'device',
      outputDeviceId: endpoint.id,
      effectiveOutputDeviceId,
      defaultOutputDeviceId,
      muted: false,
      fallback: missing ? 'selected-output-unavailable' : null
    });

  enumerateDevices.mockResolvedValue([]);
  call.bridge.listOutputs.mockResolvedValue([]);
  call.receiver.syncNativeVoiceReceive({ devicesChanged: true });
  deviceEvent('default-1', 'default-1', true);
  deviceEvent('default-2', 'default-2', true);
  await flush();
  expect(call.logger.info).toHaveBeenCalledExactlyOnceWith('native receive using default output', {
    reason: 'selected-output-unavailable'
  });
  expect(call.bridge.update.mock.calls.every(([update]) => !Object.hasOwn(update, 'outputDeviceId'))).toBe(true);
  expect(call.receiver.isNativeVoiceReceiving()).toBe(true);

  enumerateDevices.mockResolvedValue([device]);
  call.bridge.listOutputs.mockResolvedValue([endpoint]);
  deviceEvent(endpoint.id, 'default-2', false);
  call.receiver.syncNativeVoiceReceive({ devicesChanged: true });
  await flush();
  expect(call.bridge.update.mock.calls.every(([update]) => !Object.hasOwn(update, 'outputDeviceId'))).toBe(true);
  expect(call.bridge.stop).not.toHaveBeenCalled();
  expect(call.microphone.calls.enabled).toEqual([false]);
  expect(call.receiver.nativeVoiceTelemetryForReport()).toEqual({ started: true, handedOff: true });
});

test('a saved output missing at start uses the default and maps the selected endpoint when it appears', async () => {
  const call = await loadReceive(2);
  const device = { kind: 'audiooutput', deviceId: 'browser-id', label: 'Headset' };
  const enumerateDevices = vi.fn(async (): Promise<(typeof device)[]> => []);
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } });
  call.state.outputDeviceId = device.deviceId;
  await call.activate();
  expect(call.bridge.start.mock.lastCall?.[0].outputDeviceId).toBeNull();

  enumerateDevices.mockResolvedValue([device]);
  call.bridge.listOutputs.mockResolvedValue([{ id: 'wasapi-id', name: device.label, isDefault: false }]);
  call.receiver.syncNativeVoiceReceive({ devicesChanged: true });
  await flush();
  expect(call.bridge.update.mock.lastCall?.[0].outputDeviceId).toBe('wasapi-id');
  expect(call.bridge.stop).not.toHaveBeenCalled();
});

test('turning native receive off returns to Chromium even with an eligible server snapshot', async () => {
  const call = await loadReceive(2);
  await call.activate();
  Object.defineProperty(call.ports.platform.desktop, 'nativeVoicePreference', { configurable: true, value: 'off' });
  onTestFinished(() => {
    Reflect.deleteProperty(call.ports.platform.desktop, 'nativeVoicePreference');
  });
  call.receiver.syncNativeVoiceReceive();
  await flush();
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.bridge.stop).toHaveBeenCalledOnce();
  expect(call.receiver.nativeVoiceTelemetryForReport()?.fallback).toBe('preference_disabled');
});

test.each(['on', 'default'] as const)('switching from off to %s waits for the next voice join', async (preference) => {
  const call = await loadReceive(2);
  const { writeDesktopNativeVoicePreference } = await import('@/platform/desktop-native-voice');
  const { getAppRealtime } = await import('@/api/realtime');
  const realtime = getAppRealtime();
  const send = vi.spyOn(realtime, 'send').mockImplementation(() => {});
  const restore = vi.spyOn(realtime, 'onRestore');
  const member = { roomId: ROOM_ID, peerId: call.state.peerId, sessionToken: SESSION_TOKEN };
  const join = () => call.ports.transport.realtime.join({ ...member, name: 'Local' });

  writeDesktopNativeVoicePreference('off');
  join();
  expect(send.mock.lastCall?.[1]).toMatchObject({ nativeVoicePreference: 'off' });
  await call.start();

  writeDesktopNativeVoicePreference(preference);
  call.receiver.syncNativeVoiceReceive();
  await flush();
  expect(call.admit).not.toHaveBeenCalled();
  expect(call.bridge.start).not.toHaveBeenCalled();
  expect(call.receiver.nativeVoiceTelemetryForReport()).toBeUndefined();

  defined(restore.mock.lastCall, 'realtime restore handler')[0](1);
  expect(send.mock.lastCall?.[1]).toMatchObject({ nativeVoicePreference: 'off' });
  await call.start();
  expect(call.admit).not.toHaveBeenCalled();

  call.ports.transport.realtime.leave(member);
  call.receiver.resetNativeVoiceReceive();
  join();
  expect(send.mock.lastCall?.[1]).toMatchObject({ nativeVoicePreference: preference });
  await call.activate();
  expect(call.admit).toHaveBeenCalledOnce();

  const stop = Promise.withResolvers<void>();
  call.bridge.stop.mockReturnValueOnce(stop.promise);
  writeDesktopNativeVoicePreference('off');
  call.receiver.syncNativeVoiceReceive();
  expect(call.bridge.stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(call.receiver.isNativeVoiceReceiving()).toBe(false);
  expect(call.microphone.calls.enabled).toEqual([false, true]);
  expect(call.receiver.nativeVoiceTelemetryForReport()?.fallback).toBe('preference_disabled');

  writeDesktopNativeVoicePreference(preference);
  defined(restore.mock.lastCall, 'realtime restore handler')[0](2);
  expect(send.mock.lastCall?.[1]).toMatchObject({ nativeVoicePreference: 'off' });
});

test('voice poll counts a native reset followed by growth beyond the prior poll and preserves browser screen audio', async () => {
  const call = await loadReceive();
  const stats = await import('@voiceroom/call/engine/room/stats');
  const report = vi.spyOn(call.ports.transport.realtime, 'reportPoll').mockImplementation(() => {});
  stats.startPeerLatencyStats();
  onTestFinished(stats.stopPeerLatencyStats);
  await flush();
  expect(report.mock.lastCall?.[0].receiveEngine).toBe('browser');
  await call.activate();
  call.stats(96_000, {
    jitterBufferDelaySeconds: 960,
    concealedSamples: 300,
    silentConcealedSamples: 100,
    concealmentEvents: 3
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(report.mock.lastCall?.[0]).toMatchObject({
    receiveEngine: 'native',
    nativeVoice: { started: true, handedOff: true },
    jitterBufferMs: 20,
    nativeHeard: { concealedSamples: 200, gaps: 3 },
    heard: []
  });
  call.stats(0);
  call.stats(144_000, {
    jitterBufferDelaySeconds: 4_320,
    concealedSamples: 1_680,
    silentConcealedSamples: 240,
    concealmentEvents: 8
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(report.mock.lastCall?.[0]).toMatchObject({
    receiveEngine: 'native',
    jitterBufferMs: 30,
    nativeHeard: { concealedSamples: 1_440, gaps: 8 }
  });
  call.emit({ kind: 'fault', code: 'device_lost' });
  await vi.advanceTimersByTimeAsync(3000);
  expect(report.mock.lastCall?.[0]).toMatchObject({ receiveEngine: 'browser', jitterBufferMs: null });
  expect(report.mock.lastCall?.[0].nativeHeard).toBeUndefined();
  expect(call.screenAudio.calls.subscribed).toEqual([true]);
});
