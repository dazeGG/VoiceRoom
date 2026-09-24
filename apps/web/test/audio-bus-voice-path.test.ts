// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

// Loads the real audio bus through Vite with just enough of the browser
// stubbed to watch which path a remote voice takes.

class FakeMediaStream {
  getAudioTracks() {
    return [{ readyState: 'live' }];
  }
}

class FakeNode {
  constructor() {
    this.gain = { value: 1, cancelScheduledValues() {}, setValueAtTime() {} };
    this.connected = [];
  }
  connect(node) {
    this.connected.push(node);
  }
  disconnect() {
    this.connected = [];
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.sources = 0;
  }
  createGain() {
    return new FakeNode();
  }
  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = { value: 0 };
    return node;
  }
  createMediaStreamSource() {
    this.sources += 1;
    return new FakeNode();
  }
}

async function loadBus(storage = {}) {
  const store = new Map(Object.entries(storage));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: unknown) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key)
  });
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' }, setTimeout: (fn) => fn() });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.resetModules();
  const bus = await import('../src/lib/features/room/client/services/audio-bus.ts');
  const { state } = await import('../src/lib/features/room/client/core/state.svelte.ts');
  return { bus, state };
}

const voiceElement = () => ({ muted: false, srcObject: new FakeMediaStream(), volume: 1 });

test('a voice at or below 100% plays on its own element, outside the Web Audio mix', async () => {
  const { bus, state } = await loadBus();
  const element = voiceElement();
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 0.6 }), 'direct');
  assert.equal(element.muted, false);
  assert.equal(element.volume, 0.6);
  assert.equal(state.audioContext ?? null, null, 'no Web Audio graph is needed');
});

test('a boost above 100% moves the voice into the mix and silences the element', async () => {
  const { bus, state } = await loadBus();
  const element = voiceElement();
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 1.5 }), 'mixed');
  assert.equal(element.muted, true, 'the element must not be a second audible path');
  assert.equal(state.audioContext.sources, 1);

  // Back under 100% it returns to direct playback.
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 0.9 }), 'direct');
  assert.equal(element.muted, false);
});

test('master volume and output mute re-decide every voice', async () => {
  const { bus, state } = await loadBus({ 'voice-room:master-volume': '50' });
  const element = voiceElement();
  bus.playVoiceElement(element, { muted: false, volume: 1 });
  assert.equal(element.volume, 0.5);

  state.outputMuted = true;
  bus.syncAudioBusSettings();
  assert.equal(element.muted, true);

  state.outputMuted = false;
  globalThis.localStorage.setItem('voice-room:master-volume', '180');
  bus.syncAudioBusSettings();
  assert.equal(element.muted, true, 'a 180% master volume needs the mix');

  bus.releaseMediaStreamElement(element);
  element.muted = false;
  bus.syncAudioBusSettings();
  assert.equal(element.muted, false, 'a released element is no longer managed');
});
