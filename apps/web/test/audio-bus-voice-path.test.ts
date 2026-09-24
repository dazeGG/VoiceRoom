// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Loads the real audio bus through Vite with just enough of the browser
// stubbed to watch which path a remote voice takes.
const webRoot = resolve(import.meta.dirname, '..');
let serverPromise = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

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

async function loadBus(t, storage = {}) {
  const store = new Map(Object.entries(storage));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = { location: { hash: '', pathname: '/', search: '' }, setTimeout: (fn) => fn() };
  globalThis.MediaStream = FakeMediaStream;
  globalThis.AudioContext = FakeAudioContext;
  t.after(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.MediaStream;
    delete globalThis.AudioContext;
  });
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  const bus = await server.ssrLoadModule('/src/lib/features/room/client/services/audio-bus.ts');
  const { state } = await server.ssrLoadModule('/src/lib/features/room/client/core/state.svelte.ts');
  return { bus, state };
}

const voiceElement = () => ({ muted: false, srcObject: new FakeMediaStream(), volume: 1 });

test('a voice at or below 100% plays on its own element, outside the Web Audio mix', async (t) => {
  const { bus, state } = await loadBus(t);
  const element = voiceElement();
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 0.6 }), 'direct');
  assert.equal(element.muted, false);
  assert.equal(element.volume, 0.6);
  assert.equal(state.audioContext ?? null, null, 'no Web Audio graph is needed');
});

test('a boost above 100% moves the voice into the mix and silences the element', async (t) => {
  const { bus, state } = await loadBus(t);
  const element = voiceElement();
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 1.5 }), 'mixed');
  assert.equal(element.muted, true, 'the element must not be a second audible path');
  assert.equal(state.audioContext.sources, 1);

  // Back under 100% it returns to direct playback.
  assert.equal(bus.playVoiceElement(element, { muted: false, volume: 0.9 }), 'direct');
  assert.equal(element.muted, false);
});

test('master volume and output mute re-decide every voice', async (t) => {
  const { bus, state } = await loadBus(t, { 'voice-room:master-volume': '50' });
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
