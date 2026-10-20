// Speaking rings driven by the audio-thread detector: the page reacts to
// "voice started / stopped" messages instead of polling levels, applies the
// mute, deafen and push-to-talk rules, and falls back to polling an analyser
// only when AudioWorklet is unavailable.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { createParticipant } from '../../src/lib/features/room/client/room/participants.ts';
import {
  attachMeter,
  detachMeter,
  refreshAllSpeaking,
  setMicrophoneLevelReporting,
  startMeters,
  stopMeters,
  syncSpeakingThresholds
} from '../../src/lib/features/room/client/media/meters.ts';
import { defined } from '../helpers/assert.ts';

const refreshMicrophoneLevelMeter = vi.hoisted(() => vi.fn());
const context = vi.hoisted((): { value: FakeContext | null } => ({ value: null }));

vi.mock('../../src/lib/features/room/client/services/media-playback-service', () => ({
  getSharedAudioContext: () => context.value
}));
vi.mock('../../src/lib/features/room/client/ui/devices', () => ({ refreshMicrophoneLevelMeter }));

class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown) {
    this.connections.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeDetector extends FakeNode {
  static instances: FakeDetector[] = [];
  port: { onmessage: ((event: { data: unknown }) => void) | null; sent: unknown[]; postMessage(data: unknown): void } =
    {
      onmessage: null,
      sent: [],
      postMessage(data) {
        this.sent.push(data);
      }
    };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: { processorOptions: { thresholdDb: number } }
  ) {
    super();
    FakeDetector.instances.push(this);
  }
  emit(data: unknown) {
    this.port.onmessage?.({ data });
  }
}

class FakeContext {
  addModule = vi.fn(async () => {});
  audioWorklet = { addModule: this.addModule };
  sources: FakeNode[] = [];
  createMediaStreamSource() {
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), {
      fftSize: 0,
      frequencyBinCount: 64,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128)
    });
  }
}

// Registered as the global MediaStream, so `new MediaStream()` builds one.
class FakeStream {
  constructor(private readonly track: object = {}) {}
  getAudioTracks() {
    return [this.track];
  }
}

const flush = () => new Promise((resolveFlush) => setTimeout(resolveFlush, 0));

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  FakeDetector.instances = [];
  context.value = new FakeContext();
  vi.stubGlobal('AudioWorkletNode', FakeDetector);
  vi.stubGlobal('MediaStream', FakeStream);
  refreshMicrophoneLevelMeter.mockClear();
});

afterEach(() => {
  stopMeters();
  setMicrophoneLevelReporting(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function attached(id: string, name = id) {
  const participant = createParticipant({ id, name });
  attachMeter(participant, new MediaStream());
  await flush();
  return { participant, detector: defined(FakeDetector.instances.at(-1), 'speaking detector') };
}

test('a remote ring follows the detector messages and needs no timer', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const { participant, detector } = await attached('peer-a');
  startMeters();
  expect(vi.getTimerCount()).toBe(0);
  expect(detector.name).toBe('voice-room-speaking-detector');
  expect(detector.options.processorOptions.thresholdDb).toBe(-50);

  detector.emit({ type: 'speaking', speaking: true });
  expect(participant.speaking).toBe(true);
  detector.emit({ type: 'speaking', speaking: false });
  expect(participant.speaking).toBe(false);
});

test('mute and deafen hide the ring, and lifting them relights it while voice goes on', async () => {
  const { participant, detector } = await attached('peer-a');
  detector.emit({ type: 'speaking', speaking: true });

  participant.muted = true;
  refreshAllSpeaking();
  expect(participant.speaking).toBe(false);
  participant.muted = false;
  refreshAllSpeaking();
  expect(participant.speaking).toBe(true);

  state.outputMuted = true;
  refreshAllSpeaking();
  expect(participant.speaking).toBe(false);
  state.outputMuted = false;
  refreshAllSpeaking();
  expect(participant.speaking).toBe(true);
});

test('the own ring follows the gate threshold, and push-to-talk follows the key', async () => {
  state.gateThresholdDb = -35;
  const { participant, detector } = await attached('me', 'Я');
  expect(participant.isLocal).toBe(true);
  expect(detector.options.processorOptions.thresholdDb).toBe(-35);

  state.gateThresholdDb = -100;
  syncSpeakingThresholds();
  expect(detector.port.sent.at(-1)).toEqual({ type: 'set-threshold', thresholdDb: -42 });

  state.microphoneMode = 'push-to-talk';
  detector.emit({ type: 'speaking', speaking: true });
  expect(participant.speaking).toBe(false);
  state.pushToTalkActive = true;
  refreshAllSpeaking();
  expect(participant.speaking).toBe(true);
});

test('the microphone level is reported only while the popover asks for it', async () => {
  const { detector } = await attached('me', 'Я');
  detector.emit({ type: 'level', db: -30 });
  expect(refreshMicrophoneLevelMeter).not.toHaveBeenCalled();

  setMicrophoneLevelReporting(true);
  expect(detector.port.sent.at(-1)).toEqual({ type: 'report-level', enabled: true });
  detector.emit({ type: 'level', db: -30 });
  await flush();
  expect(refreshMicrophoneLevelMeter).toHaveBeenCalledWith(-30);

  setMicrophoneLevelReporting(false);
  expect(detector.port.sent.at(-1)).toEqual({ type: 'report-level', enabled: false });
});

test('a new track replaces the meter, and the old detector is silenced and disconnected', async () => {
  const { participant, detector: first } = await attached('peer-a');
  const firstSource = defined(defined(context.value, 'audio context').sources[0], 'first meter source');
  attachMeter(participant, new MediaStream());
  await flush();
  const second = defined(FakeDetector.instances.at(-1), 'speaking detector');

  expect(second).not.toBe(first);
  expect(first.port.onmessage).toBeNull();
  expect(first.disconnected && firstSource.disconnected).toBe(true);
  second.emit({ type: 'speaking', speaking: true });
  expect(participant.speaking).toBe(true);

  detachMeter(participant);
  expect(participant.meter).toBeNull();
  expect(second.disconnected).toBe(true);
});

test('without AudioWorklet an analyser is polled on the fallback timer', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('AudioWorkletNode', undefined);
  const participant = createParticipant({ id: 'peer-a', name: 'A' });
  attachMeter(participant, new MediaStream());
  expect(participant.analyser).not.toBeNull();
  startMeters();
  expect(vi.getTimerCount()).toBe(1);
  detachMeter(participant);
  expect(vi.getTimerCount()).toBe(0);
});

test('a failing worklet module falls back to the analyser', async () => {
  defined(context.value, 'audio context').addModule.mockRejectedValueOnce(new Error('blocked'));
  const participant = createParticipant({ id: 'peer-a', name: 'A' });
  attachMeter(participant, new MediaStream());
  await flush();
  expect(FakeDetector.instances).toHaveLength(0);
  expect(participant.analyser).not.toBeNull();
});
