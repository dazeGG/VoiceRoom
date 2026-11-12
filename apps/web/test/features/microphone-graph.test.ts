// The microphone capture graph runs source → RNNoise → gate → silence floor →
// gain → destination; the limiter joins only while the microphone is boosted
// above 100%, since its look-ahead would otherwise delay every word.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state.ts';
import {
  openLocalMicrophone,
  setLocalMicrophoneCapture,
  setMicrophoneCaptureEnabled,
  setMicrophoneVolume,
  stopMicrophoneCapture
} from '@/features/room/client/services/microphone-service.ts';
import type { MicrophoneCapture } from '@/features/room/client/core/types.ts';
import { defined } from '../helpers/assert.ts';

const fallback = vi.hoisted(() => vi.fn());
vi.mock('@/features/room/client/ui/devices', () => ({ fallbackRnnoiseAfterProcessorError: fallback }));

vi.mock('/rnnoise/rnnoise.mjs', () => ({
  RNNoiseNode: class {
    readonly name = 'rnnoise';
    private onError: (() => void) | null = null;
    static register = async () => {};
    constructor(readonly context: FakeContext) {
      context.rnnoise = this;
    }
    connect(target: FakeNode) {
      this.context.edges.push(`rnnoise → ${target.name}`);
    }
    disconnect() {}
    addEventListener(_type: string, listener: () => void) {
      this.onError = listener;
    }
    removeEventListener() {
      this.onError = null;
    }
    dispatchError() {
      this.onError?.();
    }
  },
  rnnoise_loadAssets: () => ({})
}));

type FakeNode = { name: string; connect(target: FakeNode): void; disconnect(): void };
let dispatchErrorOnResume = false;
let supportsCancelAndHold = true;

class FakeParam {
  value = 1;
  targets: number[] = [];
  zeros = 0;
  holds = 0;
  cancellations = 0;
  cancelAndHoldAtTime?: (time: number) => void;
  constructor() {
    if (supportsCancelAndHold)
      this.cancelAndHoldAtTime = () => {
        this.holds += 1;
      };
  }
  cancelScheduledValues() {
    this.cancellations += 1;
  }
  setTargetAtTime(value: number) {
    this.targets.push(value);
    this.value = value;
  }
  setValueAtTime(value: number) {
    if (value === 0) this.zeros += 1;
    this.value = value;
  }
}

class FakeContext {
  edges: string[] = [];
  rnnoise?: { dispatchError(): void };
  gainParam = new FakeParam();
  currentTime = 0;
  audioWorklet = { addModule: async () => {} };
  node(name: string, extra: Record<string, unknown> = {}): FakeNode {
    const edges = this.edges;
    const node: FakeNode = {
      name,
      connect(target) {
        edges.push(`${name} → ${target.name}`);
      },
      disconnect() {
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          if (edges[index]?.startsWith(`${name} →`)) edges.splice(index, 1);
        }
      },
      ...extra
    };
    return node;
  }
  createMediaStreamSource() {
    return this.node('source');
  }
  createMediaStreamDestination() {
    const track = { enabled: true, contentHint: '', stop() {} };
    return this.node('destination', {
      stream: { getAudioTracks: () => [track], getTracks: () => [track] }
    });
  }
  createGain() {
    return this.node('gain', { gain: this.gainParam });
  }
  createDynamicsCompressor() {
    const param = () => new FakeParam();
    return this.node('limiter', {
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param()
    });
  }
  async resume() {
    if (dispatchErrorOnResume) this.rnnoise?.dispatchError();
  }
  async close() {}
}

// Every context the service built; the graph under test is in the newest one.
const contexts: FakeContext[] = [];
const latest = () => defined(contexts.at(-1), 'audio context');

beforeEach(() => {
  fallback.mockClear();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  state.gateThresholdDb = -50;
  vi.stubGlobal(
    'AudioContext',
    class extends FakeContext {
      constructor() {
        super();
        contexts.push(this);
      }
    }
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      readonly name: string;
      readonly port = { postMessage() {} };
      constructor(
        readonly context: FakeContext,
        processorName: string
      ) {
        this.name = processorName === 'voice-room-silence-floor' ? 'silence-floor' : 'gate';
      }
      connect(target: FakeNode) {
        this.context.edges.push(`${this.name} → ${target.name}`);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        const track = { enabled: true, stop() {} };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      }
    }
  });
  localStorage.clear();
});

afterEach(() => {
  dispatchErrorOnResume = false;
  supportsCancelAndHold = true;
  vi.unstubAllGlobals();
});

test('RNNoise comes before the gate, the silence floor last before the gain, and the gain feeds the destination directly', async () => {
  state.noiseMode = 'rnnoise';
  state.microphoneVolume = 100;
  const capture: MicrophoneCapture = await openLocalMicrophone();

  expect(capture.mode).toBe('rnnoise');
  expect([...latest().edges].sort()).toEqual(
    [
      'source → rnnoise',
      'rnnoise → gate',
      'gate → silence-floor',
      'silence-floor → gain',
      'gain → destination',
      'limiter → destination'
    ].sort()
  );
});

test('without AudioWorklet the capture still works, only without the silence floor', async () => {
  vi.stubGlobal('AudioWorkletNode', undefined);
  state.noiseMode = 'browser';
  state.gateThresholdDb = -100;
  state.microphoneVolume = 100;
  await openLocalMicrophone();
  expect([...latest().edges].sort()).toEqual(['source → gain', 'gain → destination', 'limiter → destination'].sort());
});

test('boosting above 100% routes the gain through the limiter, and back when lowered', async () => {
  state.noiseMode = 'browser';
  state.microphoneVolume = 100;
  setLocalMicrophoneCapture(await openLocalMicrophone());
  expect(latest().edges).toContain('gain → destination');

  setMicrophoneVolume(150);
  expect(latest().edges).toContain('gain → limiter');
  expect(latest().edges).not.toContain('gain → destination');

  setMicrophoneVolume(80);
  expect(latest().edges).toContain('gain → destination');
  expect(latest().edges).not.toContain('gain → limiter');
});

test('candidate raw and final gain remain hard-zero until committed under latest intent', async () => {
  state.noiseMode = 'browser';
  state.microphoneVolume = 80;
  const capture = await openLocalMicrophone();
  const raw = defined(capture.rawStream?.getAudioTracks()[0], 'raw track');
  const output = defined(capture.stream?.getAudioTracks()[0], 'output track');
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  output.enabled = true; // LiveKit replaceTrack may re-enable the processed output.
  setMicrophoneVolume(120);
  expect(latest().gainParam.value).toBe(0);
  state.muted = true;
  setLocalMicrophoneCapture(capture);
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  state.muted = false;
  state.microphoneMode = 'push-to-talk';
  state.pushToTalkActive = false;
  setLocalMicrophoneCapture(capture);
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  state.pushToTalkActive = true;
  setLocalMicrophoneCapture(capture);
  expect(raw.enabled).toBe(true);
  expect(latest().gainParam.value).toBe(1.2);
});

test('nonzero gain is smoothed while a later privacy barrier remains an immediate zero', async () => {
  state.noiseMode = 'browser';
  state.microphoneVolume = 80;
  const capture = await openLocalMicrophone();
  setLocalMicrophoneCapture(capture);
  expect(latest().gainParam.targets).toEqual([0.8]);
  setMicrophoneVolume(120);
  expect(latest().gainParam.targets).toEqual([0.8, 1.2]);
  state.muted = true;
  setLocalMicrophoneCapture(capture);
  expect(latest().gainParam.value).toBe(0);
  expect(latest().gainParam.zeros).toBeGreaterThan(1);
  expect(latest().gainParam.holds).toBeGreaterThan(2);
});

test('without cancelAndHoldAtTime commit, mute, PTT close, and reopen keep the hard-zero barrier', async () => {
  supportsCancelAndHold = false;
  state.noiseMode = 'browser';
  state.microphoneVolume = 90;
  state.muted = false;
  const first = await openLocalMicrophone();
  setLocalMicrophoneCapture(first);
  const raw = defined(first.rawStream?.getAudioTracks()[0], 'raw track');
  expect(raw.enabled).toBe(true);
  setMicrophoneVolume(120);
  expect(latest().gainParam.targets).toEqual([0.9, 1.2]);
  state.muted = true;
  setMicrophoneCaptureEnabled(first, false);
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  state.microphoneMode = 'push-to-talk';
  state.muted = false;
  state.pushToTalkActive = false;
  setMicrophoneCaptureEnabled(first, true);
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  state.pushToTalkActive = true;
  setMicrophoneCaptureEnabled(first, true);
  expect(raw.enabled).toBe(true);
  state.pushToTalkActive = false;
  setMicrophoneCaptureEnabled(first, true);
  expect(raw.enabled).toBe(false);
  expect(latest().gainParam.value).toBe(0);
  stopMicrophoneCapture(first);
  const reopened = await openLocalMicrophone();
  expect(defined(reopened.rawStream?.getAudioTracks()[0], 'reopened raw').enabled).toBe(false);
  setLocalMicrophoneCapture(reopened);
  expect(latest().gainParam.value).toBe(0);
  expect(latest().gainParam.cancellations).toBeGreaterThan(1);
});

test('RNNoise failure during preparation or candidate barrier is latched before commit', async () => {
  state.noiseMode = 'rnnoise';
  state.muted = true;
  dispatchErrorOnResume = true;
  const first = await openLocalMicrophone();
  expect(first.processorFailed).toBe(true);
  dispatchErrorOnResume = false;
  latest().rnnoise?.dispatchError();
  expect(first.processorFailed).toBe(true);
  stopMicrophoneCapture(first);

  const priorContexts = contexts.length;
  const secondOpen = openLocalMicrophone();
  await vi.waitFor(() => {
    expect(contexts.length).toBeGreaterThan(priorContexts);
    expect(latest().rnnoise).toBeDefined();
  });
  const preparing = latest();
  preparing.rnnoise?.dispatchError();
  const second = await secondOpen;
  expect(second.processorFailed).toBe(true);
  expect(second.barrier).toBe(true);
  let resolvePublish = () => {};
  const published = new Promise<void>((resolve) => {
    resolvePublish = resolve;
  });
  const commit = published.then(() => setLocalMicrophoneCapture(second));
  expect(fallback).not.toHaveBeenCalled();
  state.muted = false;
  resolvePublish();
  await commit;
  await vi.waitFor(() => expect(fallback).toHaveBeenCalledWith(second));
  expect(fallback).toHaveBeenCalledTimes(1);
  stopMicrophoneCapture(second);
  preparing.rnnoise?.dispatchError();
  expect(second.processorFailed).toBeUndefined();
  setMicrophoneCaptureEnabled(second, true);
  expect(fallback).toHaveBeenCalledTimes(1);
});

test('a browser without RNNoise falls back with one toast a page, and the saved choice stays RNNoise', async () => {
  vi.stubGlobal('AudioWorkletNode', undefined);
  state.noiseMode = 'rnnoise';
  const { useToastUiStore } = await import('@/features/room/toast-ui.store');
  const first = await openLocalMicrophone();
  const second = await openLocalMicrophone();
  expect([first.mode, second.mode]).toEqual(['browser', 'browser']);
  expect(state.noiseMode).toBe('rnnoise');
  expect(
    useToastUiStore().items.filter((item) => item.message === 'RNNoise недоступен, включен браузерный шумодав')
  ).toHaveLength(1);
});
