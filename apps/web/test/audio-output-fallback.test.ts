// The real audio bus with a saved speaker that comes and goes: the sound falls
// back to the system device, the saved choice stays, and a device picked by hand
// still reports its failure instead of quietly playing somewhere else.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { instanceOf } from './helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from './helpers/fake-media.ts';

const available = new Set<string>();
const contextRequests: string[] = [];
const elementRequests: string[] = [];

class FakeNode {
  gain = { value: 1, cancelScheduledValues() {}, setValueAtTime() {} };
  connected: FakeNode[] = [];
  connect(node: FakeNode) {
    this.connected.push(node);
  }
  disconnect() {
    this.connected = [];
  }
}

function deviceAnswer(sinkId: string, currentSinkId: string): Promise<void> {
  // Selecting the current sink succeeds without touching the device, as in Chromium.
  if (sinkId === currentSinkId || sinkId === '' || available.has(sinkId)) return Promise.resolve();
  return Promise.reject(Object.assign(new Error('gone'), { name: 'NotFoundError' }));
}

class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  sinkId = '';
  createGain() {
    return new FakeNode();
  }
  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) Object.assign(node, { [key]: { value: 0 } });
    return node;
  }
  async setSinkId(sinkId: string) {
    contextRequests.push(sinkId);
    await deviceAnswer(sinkId, this.sinkId);
    this.sinkId = sinkId;
  }
}

async function loadBus(savedSink = '') {
  const store = new Map(savedSink ? [['voice-room:output-device-id', savedSink]] : []);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: unknown) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key)
  });
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' }, setTimeout: (fn: () => void) => fn() });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.resetModules();
  const bus = await import('@/features/room/client/services/audio-bus.ts');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const graph = bus.getAudioBusGraph();
  const context = instanceOf(graph.context, FakeAudioContext, 'the bus context');
  const limiter = instanceOf(graph.limiter, FakeNode, 'the limiter');
  const audible = () => limiter.connected.includes(context.destination);
  return { audible, bus, context, state, store };
}

function voiceElement(): HTMLMediaElement {
  const element = document.createElement('audio');
  element.srcObject = new FakeMediaStream([new FakeMediaStreamTrack('voice', 'audio')]);
  return element;
}

beforeEach(() => {
  available.clear();
  contextRequests.length = 0;
  elementRequests.length = 0;
  Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
    configurable: true,
    async value(this: HTMLMediaElement, sinkId: string) {
      elementRequests.push(sinkId);
      await deviceAnswer(sinkId, this.sinkId || '');
      Object.assign(this, { sinkId });
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
  vi.unstubAllGlobals();
});

test('a saved speaker missing at the start plays on the system device and stays saved', async () => {
  const { audible, bus, context, state, store } = await loadBus('gone');

  await vi.waitFor(() => assert.equal(audible(), true));

  assert.deepEqual(contextRequests, ['gone', '']);
  assert.equal(context.sinkId, '');
  assert.equal(bus.isOutputOnSystemFallback(), true);
  assert.equal(state.outputDeviceId, 'gone');
  assert.equal(store.get('voice-room:output-device-id'), 'gone');
});

test('the saved speaker is selected again when it returns', async () => {
  const { audible, bus, context } = await loadBus('gone');
  await vi.waitFor(() => assert.equal(bus.isOutputOnSystemFallback(), true));

  available.add('gone');
  assert.equal(await bus.restoreSavedOutput(), true);

  assert.equal(context.sinkId, 'gone');
  assert.equal(audible(), true);
  assert.equal(bus.isOutputOnSystemFallback(), false);
});

test('a speaker lost during the call is left without asking it first, once', async () => {
  available.add('headphones');
  const { audible, bus, context, state } = await loadBus('headphones');
  await vi.waitFor(() => assert.equal(context.sinkId, 'headphones'));

  available.delete('headphones');
  assert.equal(await bus.moveOutputToSystem(), true);

  assert.equal(context.sinkId, '');
  assert.equal(audible(), true);
  assert.equal(bus.isOutputOnSystemFallback(), true);
  assert.equal(state.outputDeviceId, 'headphones');

  contextRequests.length = 0;
  assert.equal(await bus.moveOutputToSystem(), true);
  assert.deepEqual(contextRequests, []);
});

test('a device picked by hand reports its failure, and going back brings the sound back', async () => {
  const { audible, bus, context } = await loadBus();
  await vi.waitFor(() => assert.equal(audible(), true));

  assert.equal(await bus.setOutputDevice('gone'), false);
  assert.equal(bus.isOutputOnSystemFallback(), false);
  assert.equal(audible(), false);

  assert.equal(await bus.restoreOutputDevice(''), true);
  assert.equal(context.sinkId, '');
  assert.equal(audible(), true);
});

test('choosing a working device ends the fallback', async () => {
  available.add('speakers');
  const { audible, bus, context } = await loadBus('gone');
  await vi.waitFor(() => assert.equal(bus.isOutputOnSystemFallback(), true));

  assert.equal(await bus.setOutputDevice('speakers'), true);

  assert.equal(context.sinkId, 'speakers');
  assert.equal(audible(), true);
  assert.equal(bus.isOutputOnSystemFallback(), false);
});

test('a voice follows the fallback and never asks for the speaker that is gone', async () => {
  available.add('headphones');
  const { bus, context } = await loadBus('headphones');
  await vi.waitFor(() => assert.equal(context.sinkId, 'headphones'));
  const element = voiceElement();
  bus.playVoiceElement(element, { muted: false, volume: 0.5 });
  await vi.waitFor(() => assert.equal(element.sinkId, 'headphones'));

  available.delete('headphones');
  await bus.moveOutputToSystem();
  await vi.waitFor(() => assert.equal(element.sinkId, ''));

  elementRequests.length = 0;
  const late = voiceElement();
  bus.playVoiceElement(late, { muted: false, volume: 0.5 });
  bus.playVoiceElement(element, { muted: false, volume: 0.7 });
  await Promise.resolve();

  assert.deepEqual(elementRequests, []);
  assert.equal(late.sinkId || '', '');
});
