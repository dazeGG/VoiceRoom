// The microphone capture graph runs source → RNNoise → gate → gain →
// destination; the limiter joins only while the microphone is boosted above
// 100%, since its look-ahead would otherwise delay every word.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  openLocalMicrophone,
  setMicrophoneVolume
} from '../../src/lib/features/room/client/services/microphone-service.ts';
import type { MicrophoneCapture } from '../../src/lib/features/room/client/core/types.ts';

vi.mock('/rnnoise/rnnoise.mjs', () => ({
  RNNoiseNode: class {
    readonly name = 'rnnoise';
    static register = async () => {};
    constructor(readonly context: FakeContext) {}
    connect(target: FakeNode) {
      this.context.edges.push(`rnnoise → ${target.name}`);
    }
    disconnect() {}
  },
  rnnoise_loadAssets: () => ({})
}));

type FakeNode = { name: string; connect(target: FakeNode): void; disconnect(): void };

class FakeParam {
  value = 1;
  cancelScheduledValues() {}
  setTargetAtTime(value: number) {
    this.value = value;
  }
}

class FakeContext {
  edges: string[] = [];
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
          if (edges[index].startsWith(`${name} →`)) edges.splice(index, 1);
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
    return this.node('destination', {
      stream: { getAudioTracks: () => [{ enabled: true, contentHint: '' }] }
    });
  }
  createGain() {
    return this.node('gain', { gain: new FakeParam() });
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
  async resume() {}
  async close() {}
}

// Every context the service built; the graph under test is in the newest one.
const contexts: FakeContext[] = [];
const latest = () => contexts[contexts.length - 1];

beforeEach(() => {
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
      readonly name = 'gate';
      readonly port = { postMessage() {} };
      constructor(readonly context: FakeContext) {}
      connect(target: FakeNode) {
        this.context.edges.push(`gate → ${target.name}`);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: async () => ({ getAudioTracks: () => [{ enabled: true, stop() {} }], getTracks: () => [] })
    }
  });
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

test('RNNoise comes before the gate and the gain feeds the destination directly', async () => {
  state.noiseMode = 'rnnoise';
  state.microphoneVolume = 100;
  const capture: MicrophoneCapture = await openLocalMicrophone();

  expect(capture.mode).toBe('rnnoise');
  expect([...latest().edges].sort()).toEqual(
    ['source → rnnoise', 'rnnoise → gate', 'gate → gain', 'gain → destination', 'limiter → destination'].sort()
  );
});

test('boosting above 100% routes the gain through the limiter, and back when lowered', async () => {
  state.noiseMode = 'browser';
  state.microphoneVolume = 100;
  state.micProcessor = (await openLocalMicrophone()).processor;
  expect(latest().edges).toContain('gain → destination');

  setMicrophoneVolume(150);
  expect(latest().edges).toContain('gain → limiter');
  expect(latest().edges).not.toContain('gain → destination');

  setMicrophoneVolume(80);
  expect(latest().edges).toContain('gain → destination');
  expect(latest().edges).not.toContain('gain → limiter');
});
