import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

async function loadScreenAudioControls() {
  const stubUrl = moduleUrl(`
    export const state = { screenMuted: false, screenVolume: 1 };
    export const screenUi = {};
    export const testState = { applied: [], peer: null, released: [] };
    export const MAX_STREAM_VOLUME = 2;
    export const showToast = () => {};
    export const clampStreamVolume = (value, max) => Math.min(max, Math.max(0, value));
    export const normalizeStoredStreamVolume = (value) => value;
    export const storeStreamVolume = (value) => value;
    export const isAppPlaybackMuted = () => false;
    export const applyScreenMediaElementVolume = (element, options) => {
      testState.applied.push({ element, options });
      return true;
    };
    export const releaseScreenMediaElement = (element) => { testState.released.push(element); };
    export const bumpScreenUiRevision = () => {};
    export const getActiveScreenPeer = () => testState.peer;
    export const getScreenStage = () => null;
    export const getScreenVideo = () => null;
    export const getStreamVolumeSlider = () => null;
  `);
  const path = 'src/lib/features/room/client/ui/screen-stage-controls.ts';
  const source = readFileSync(resolve(root, path), 'utf8').replace(/from '[^']+'/g, `from '${stubUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  return {
    controls: await import(moduleUrl(output)),
    testState: (await import(stubUrl)).testState
  };
}

class TestMediaStream {
  constructor(tracks) {
    this.tracks = tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

test('screen audio keeps a routed fallback sink during a video republish gap', async () => {
  const appended = [];
  const previousDocument = globalThis.document;
  const previousMediaStream = globalThis.MediaStream;
  globalThis.MediaStream = TestMediaStream;
  globalThis.document = {
    body: {
      append(element) {
        appended.push(element);
      }
    },
    createElement() {
      return {
        autoplay: false,
        muted: false,
        pause() {},
        remove() { this.removed = true; },
        srcObject: null
      };
    }
  };

  try {
    const { controls, testState } = await loadScreenAudioControls();
    const endedListeners = [];
    const audioTrack = {
      addEventListener(_event, listener) { endedListeners.push(listener); },
      id: 'screen-audio',
      kind: 'audio',
      readyState: 'live'
    };
    const peer = {
      isLocal: false,
      screenStream: new TestMediaStream([audioTrack])
    };
    testState.peer = peer;

    controls.syncScreenAudioFallback(peer, false);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].srcObject.getAudioTracks()[0], audioTrack);
    assert.equal(testState.applied.at(-1).element, appended[0]);
    assert.equal(testState.applied.at(-1).options.boostAllowed, true);

    controls.syncScreenAudioFallback(peer, false);
    assert.equal(appended.length, 1, 'the same live track reuses its audio sink');

    controls.syncScreenAudioFallback(peer, true);
    assert.equal(testState.released.at(-1), appended[0]);
    assert.equal(appended[0].removed, true);

    controls.syncScreenAudioFallback(peer, false);
    assert.equal(appended.length, 2);
    endedListeners.at(-1)();
    assert.equal(appended[1].removed, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.MediaStream = previousMediaStream;
  }
});
