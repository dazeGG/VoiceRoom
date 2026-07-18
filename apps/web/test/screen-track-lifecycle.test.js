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

async function loadParticipantScreenLifecycle() {
  const stubUrl = moduleUrl(`
    export const state = {
      viewedScreenPeerId: '',
      sharedScreenPeerId: '',
      screenRequesting: false,
      screenSubscribedPeerIds: new Set()
    };
    export const testState = { stageRefreshes: 0 };
    export const participantsUi = { revision: 0 };
    export const reactiveParticipant = (participant) => participant;
    export const bumpParticipantsRevision = () => {};
    export const closeParticipantContextMenu = () => {};
    export const getScreenProfile = () => ({ id: 'balanced-30' });
    export const applyRemoteParticipantAudioPreferences = () => {};
    export const playMediaElement = () => {};
    export const releaseRemoteAudioElement = () => {};
    export const STREAM_CUE_DEDUPE_MS = 1000;
    export const clearPeerJoinCue = () => {};
    export const playStreamCue = () => {};
    export const playStreamViewerCue = () => {};
    export const attachMeter = () => {};
    export const syncLiveKitScreenSubscriptions = () => {};
    export const disconnectScreen = () => {};
    export const hideScreenStage = () => {};
    export const refreshAllScreenActions = () => {};
    export const refreshScreenStage = () => { testState.stageRefreshes += 1; };
    export const refreshScreenTiles = () => {};
  `);
  const path = 'src/lib/features/room/client/room/participants.ts';
  const source = readFileSync(resolve(root, path), 'utf8')
    .replace(/from '[^']+'/g, `from '${stubUrl}'`)
    .replace(/import\('[^']+'\)/g, `import('${stubUrl}')`);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  return {
    lifecycle: await import(moduleUrl(output)),
    state: (await import(stubUrl)).state,
    testState: (await import(stubUrl)).testState
  };
}

function track(id, kind) {
  return {
    id,
    kind,
    readyState: 'live',
    addEventListener() {}
  };
}

class TestMediaStream {
  constructor(tracks, id = 'screen-stream') {
    this.id = id;
    this.tracks = [...tracks];
  }

  addTrack(mediaTrack) {
    this.tracks.push(mediaTrack);
  }

  removeTrack(mediaTrack) {
    this.tracks = this.tracks.filter((candidate) => candidate !== mediaTrack);
  }

  getTracks() {
    return [...this.tracks];
  }

  getVideoTracks() {
    return this.tracks.filter((candidate) => candidate.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter((candidate) => candidate.kind === 'audio');
  }
}

test('screen video unsubscribe, unpublish, and republish preserve stable screen audio', async () => {
  const { lifecycle, state } = await loadParticipantScreenLifecycle();
  const audio = track('audio-stable', 'audio');
  const firstVideo = track('video-first', 'video');
  const peer = {
    id: 'peer-a',
    isLocal: false,
    livekitParticipant: {},
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new TestMediaStream([audio, firstVideo]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  };
  state.viewedScreenPeerId = peer.id;
  state.screenSubscribedPeerIds.add(peer.id);

  lifecycle.detachRemoteScreenVideoTrack(peer, firstVideo.id);
  assert.deepEqual(peer.screenStream.getVideoTracks(), []);
  assert.deepEqual(peer.screenStream.getAudioTracks(), [audio]);
  assert.equal(state.screenRequesting, true);

  lifecycle.detachRemoteScreenVideoTracks(peer);
  assert.equal(peer.screenStream.getAudioTracks()[0], audio);

  const replacementVideo = track('video-republished', 'video');
  lifecycle.attachRemoteScreenStream(peer, new TestMediaStream([replacementVideo], 'replacement-stream'));
  assert.equal(peer.screenStream.getAudioTracks()[0], audio);
  assert.equal(peer.screenStream.getVideoTracks()[0], replacementVideo);
  assert.equal(state.screenRequesting, false);
});

test('per-track screen detach keeps replacement video and ignores duplicate ended events', async () => {
  const { lifecycle, state } = await loadParticipantScreenLifecycle();
  const audio = track('audio', 'audio');
  const oldVideo = track('video-old', 'video');
  const replacementVideo = track('video-new', 'video');
  const peer = {
    id: 'peer-b',
    isLocal: false,
    livekitParticipant: {},
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new TestMediaStream([audio, oldVideo, replacementVideo]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  };
  state.viewedScreenPeerId = peer.id;
  state.screenRequesting = false;

  lifecycle.detachRemoteScreenVideoTrack(peer, oldVideo.id);
  assert.deepEqual(peer.screenStream.getVideoTracks(), [replacementVideo]);
  assert.equal(state.screenRequesting, false);

  lifecycle.detachRemoteScreenVideoTrack(peer, oldVideo.id);
  lifecycle.detachRemoteScreenVideoTrack(peer, 'unknown-video');
  assert.deepEqual(peer.screenStream.getVideoTracks(), [replacementVideo]);

  lifecycle.detachRemoteScreenAudioTrack(peer, audio.id);
  assert.deepEqual(peer.screenStream.getAudioTracks(), []);
  assert.deepEqual(peer.screenStream.getVideoTracks(), [replacementVideo]);
});

test('screen audio arriving after video loss refreshes the active stage fallback', async () => {
  const { lifecycle, state, testState } = await loadParticipantScreenLifecycle();
  const video = track('video-ended', 'video');
  const peer = {
    id: 'peer-audio-recovery',
    isLocal: false,
    livekitParticipant: {},
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new TestMediaStream([video]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  };
  state.viewedScreenPeerId = peer.id;
  state.screenSubscribedPeerIds.add(peer.id);

  lifecycle.detachRemoteScreenVideoTrack(peer, video.id);
  await new Promise((resolve) => setImmediate(resolve));
  testState.stageRefreshes = 0;

  const audio = track('audio-late', 'audio');
  lifecycle.attachRemoteScreenStream(peer, new TestMediaStream([audio], 'late-audio-stream'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(peer.screenStream.getAudioTracks(), [audio]);
  assert.equal(peer.screenStream.getVideoTracks().length, 0);
  assert.equal(testState.stageRefreshes, 1);
});
