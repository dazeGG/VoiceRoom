import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { NativeVoiceBridge, NativeVoiceEvent } from '@voiceroom/call/engine/desktop-capabilities';
import type { NativeVoiceAdmission } from '@voiceroom/shared/contracts/admission';
import { fakeParticipant, fakePublication, loadLiveKitHarness } from '../helpers/livekit-harness';
import { defined } from '../helpers/assert';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';

const capability = { version: 1, stage: 'receive', generation: 'a'.repeat(32) } as const;
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

function desktopBridge() {
  const listeners = new Set<(event: NativeVoiceEvent) => void>();
  const bridge = {
    getCapability: vi.fn<NativeVoiceBridge['getCapability']>(async () => ({
      available: true,
      protocol: { major: 1, minor: 0 }
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

async function loadReceive() {
  vi.useFakeTimers();
  stubVoicePlayback();
  const desktop = desktopBridge();
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
  const logger = { ...ports.diagnostics.logger('test'), warn: vi.fn() };
  vi.spyOn(ports.diagnostics, 'logger').mockReturnValue(logger);
  vi.stubGlobal('voiceRoomDesktopNativeVoice', desktop.bridge);
  Object.assign(lk.state, {
    roomId: 'voice-room',
    sessionToken: 'session-token',
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
