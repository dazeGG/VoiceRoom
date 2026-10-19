import { afterEach, test, vi } from 'vitest';
import type { Participant } from '../src/lib/features/room/client/core/types.ts';
import { participant as participantFixture } from './fixtures/participant.ts';
import { defined } from './helpers/assert.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from './helpers/fake-media.ts';

// Participants reach the screen view through dynamic imports (they break an
// import cycle), so every refresh lands after the call returns. Waiting for
// them keeps a test from racing its own refreshes, and settling them after
// each test keeps a late import out of the next test's fresh module graph.
afterEach(() => vi.dynamicImportSettled());
import assert from 'node:assert/strict';

async function loadParticipantScreenLifecycle() {
  vi.resetModules();
  const testState = { stageRefreshes: 0 };
  vi.doMock('../src/lib/features/room/client/services/media-playback-service', () => ({
    applyRemoteParticipantAudioPreferences: () => {},
    playMediaElement: () => {},
    releaseRemoteAudioElement: () => {}
  }));
  vi.doMock('../src/lib/features/room/client/media/cues', () => ({
    clearPeerJoinCue: () => {},
    playStreamCue: () => {},
    playStreamViewerCue: () => {}
  }));
  vi.doMock('../src/lib/features/room/client/media/meters', () => ({
    attachMeter: () => {},
    detachMeter: () => {},
    refreshSpeaking: () => {}
  }));
  vi.doMock('../src/lib/features/room/client/services/livekit-service', () => ({
    syncLiveKitScreenSubscriptions: () => {}
  }));
  vi.doMock('../src/lib/features/room/client/ui/screen-view', () => ({
    disconnectScreen: () => {},
    hideScreenStage: () => {},
    refreshAllScreenActions: () => {},
    refreshScreenStage: () => {
      testState.stageRefreshes += 1;
    },
    refreshScreenTiles: () => {}
  }));
  const lifecycle = await import('../src/lib/features/room/client/room/participants.ts');
  const { state } = await import('../src/lib/features/room/client/core/state.svelte.ts');
  state.viewedScreenPeerId = '';
  state.screenRequesting = false;
  return { lifecycle, state, testState };
}

const track = (id: string, kind: 'audio' | 'video') => new FakeMediaStreamTrack(id, kind);

// The stream a test participant shares; it always has one in these tests.
const shared = (peer: Participant) => defined(peer.screenStream, `${peer.id}'s screen stream`);

test('screen video unsubscribe, unpublish, and republish preserve stable screen audio', async () => {
  const { lifecycle, state } = await loadParticipantScreenLifecycle();
  const audio = track('audio-stable', 'audio');
  const firstVideo = track('video-first', 'video');
  const peer = participantFixture({
    id: 'peer-a',
    isLocal: false,
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new FakeMediaStream([audio, firstVideo]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  });
  state.viewedScreenPeerId = peer.id;
  state.screenSubscribedPeerIds.add(peer.id);

  lifecycle.detachRemoteScreenVideoTrack(peer, firstVideo.id);
  assert.deepEqual(shared(peer).getVideoTracks(), []);
  assert.deepEqual(shared(peer).getAudioTracks(), [audio]);
  assert.equal(state.screenRequesting, true);

  lifecycle.detachRemoteScreenVideoTracks(peer);
  assert.equal(shared(peer).getAudioTracks()[0], audio);

  const replacementVideo = track('video-republished', 'video');
  lifecycle.attachRemoteScreenStream(peer, new FakeMediaStream([replacementVideo], 'replacement-stream'));
  assert.equal(shared(peer).getAudioTracks()[0], audio);
  assert.equal(shared(peer).getVideoTracks()[0], replacementVideo);
  assert.equal(state.screenRequesting, false);
});

test('per-track screen detach keeps replacement video and ignores duplicate ended events', async () => {
  const { lifecycle, state } = await loadParticipantScreenLifecycle();
  const audio = track('audio', 'audio');
  const oldVideo = track('video-old', 'video');
  const replacementVideo = track('video-new', 'video');
  const peer = participantFixture({
    id: 'peer-b',
    isLocal: false,
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new FakeMediaStream([audio, oldVideo, replacementVideo]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  });
  state.viewedScreenPeerId = peer.id;
  state.screenRequesting = false;

  lifecycle.detachRemoteScreenVideoTrack(peer, oldVideo.id);
  assert.deepEqual(shared(peer).getVideoTracks(), [replacementVideo]);
  assert.equal(state.screenRequesting, false);

  lifecycle.detachRemoteScreenVideoTrack(peer, oldVideo.id);
  lifecycle.detachRemoteScreenVideoTrack(peer, 'unknown-video');
  assert.deepEqual(shared(peer).getVideoTracks(), [replacementVideo]);

  lifecycle.detachRemoteScreenAudioTrack(peer, audio.id);
  assert.deepEqual(shared(peer).getAudioTracks(), []);
  assert.deepEqual(shared(peer).getVideoTracks(), [replacementVideo]);
});

test('screen audio arriving after video loss refreshes the active stage fallback', async () => {
  const { lifecycle, state, testState } = await loadParticipantScreenLifecycle();
  const video = track('video-ended', 'video');
  const peer = participantFixture({
    id: 'peer-audio-recovery',
    isLocal: false,
    muted: false,
    screen: true,
    screenAudio: true,
    screenStream: new FakeMediaStream([video]),
    screenStreamId: 'screen-stream',
    statusLabel: '',
    voiceIssue: ''
  });
  state.viewedScreenPeerId = peer.id;
  state.screenSubscribedPeerIds.add(peer.id);

  lifecycle.detachRemoteScreenVideoTrack(peer, video.id);
  await vi.dynamicImportSettled();
  testState.stageRefreshes = 0;

  const audio = track('audio-late', 'audio');
  lifecycle.attachRemoteScreenStream(peer, new FakeMediaStream([audio], 'late-audio-stream'));
  await vi.dynamicImportSettled();

  assert.deepEqual(shared(peer).getAudioTracks(), [audio]);
  assert.equal(shared(peer).getVideoTracks().length, 0);
  assert.equal(testState.stageRefreshes, 1);
});
