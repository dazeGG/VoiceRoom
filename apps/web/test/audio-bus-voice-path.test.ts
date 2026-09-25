import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

// Loads the real audio bus through Vite with just enough of the browser
// stubbed to watch which path a remote voice takes.

class FakeMediaStream {
  getAudioTracks() {
    return [{ readyState: 'live' }];
  }
}

type FakeGain = {
  value: number;
  scheduled: Array<[number, number]>;
  cancelScheduledValues(): void;
  setValueAtTime(value: number, at: number): void;
};

class FakeNode {
  gain: FakeGain;
  connected: FakeNode[];
  constructor() {
    this.gain = {
      value: 1,
      scheduled: [],
      cancelScheduledValues() { this.scheduled = []; },
      setValueAtTime(value: number, at: number) { this.scheduled.push([value, at]); }
    };
    this.connected = [];
  }
  connect(node: FakeNode) {
    this.connected.push(node);
  }
  disconnect() {
    this.connected = [];
  }
}

class FakeAudioContext {
  currentTime: number;
  destination: FakeNode;
  sources: number;
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
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) Object.assign(node, { [key]: { value: 0 } });
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
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' }, setTimeout: (fn: () => void) => fn() });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.resetModules();
  const bus = await import('../src/lib/features/room/client/services/audio-bus.ts');
  const { state } = await import('../src/lib/features/room/client/core/state.svelte.ts');
  return { bus, state };
}

const voiceElement = () => ({ muted: false, srcObject: new FakeMediaStream(), volume: 1 }) as unknown as HTMLMediaElement;

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
  assert.equal((state.audioContext as unknown as FakeAudioContext).sources, 1);

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

test('muting the output lets the confirmation cue finish before the master bus goes silent', async () => {
  const { bus, state } = await loadBus();
  const graph = bus.getAudioBusGraph() as unknown as Record<'master', FakeNode>;
  state.outputMuted = true;
  bus.syncAudioBusSettings({ muteDelayMs: 220 });
  assert.deepEqual(graph.master.gain.scheduled, [[1, 0], [0, 0.22]]);

  state.outputMuted = false;
  bus.syncAudioBusSettings({ muteDelayMs: 220 });
  assert.deepEqual(graph.master.gain.scheduled, [[1, 0]], 'unmuting is immediate');
});

test('interface sounds go through their own bus input at the stored notification volume', async () => {
  const { bus } = await loadBus({ 'voice-room:notification-volume': '50' });
  const graph = bus.getAudioBusGraph() as unknown as Record<'sfx' | 'master', FakeNode>;
  bus.syncAudioBusSettings();
  assert.equal(bus.getAudioBusInput('sfx'), graph.sfx);
  assert.equal(graph.sfx.gain.value, 0.5);
  assert.ok(graph.sfx.connected.includes(graph.master), 'sounds are mixed under the master volume');
});
