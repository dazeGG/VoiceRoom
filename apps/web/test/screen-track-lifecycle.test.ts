// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';


async function loadParticipantScreenLifecycle() {
  vi.resetModules();
  const testState = { stageRefreshes: 0 };
  vi.doMock('../src/lib/features/room/client/services/media-playback-service', () => ({
    applyRemoteParticipantAudioPreferences: () => {},
    playMediaElement: () => {},
    releaseRemoteAudioElement: () => {}
  }));
  vi.doMock('../src/lib/features/room/client/media/cues', () => ({ clearPeerJoinCue: () => {}, playStreamCue: () => {}, playStreamViewerCue: () => {} }));
  vi.doMock('../src/lib/features/room/client/media/meters', () => ({ attachMeter: () => {} }));
  vi.doMock('../src/lib/features/room/client/services/livekit-service', () => ({ syncLiveKitScreenSubscriptions: () => {} }));
  vi.doMock('../src/lib/features/room/client/ui/screen-view', () => ({
    disconnectScreen: () => {},
    hideScreenStage: () => {},
    refreshAllScreenActions: () => {},
    refreshScreenStage: () => { testState.stageRefreshes += 1; },
    refreshScreenTiles: () => {}
  }));
  const lifecycle = await import('../src/lib/features/room/client/room/participants.ts');
  const { state } = await import('../src/lib/features/room/client/core/state.svelte.ts');
  state.viewedScreenPeerId = '';
  state.screenRequesting = false;
  return { lifecycle, state, testState };
}

function track(id: string, kind: string) {
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
