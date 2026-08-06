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

async function loadLiveKitService() {
  const stubUrl = moduleUrl(`
    export const MICROPHONE_AUDIO_BITRATE = 64_000;
    export const SCREEN_AUDIO_BITRATE = 192_000;
    export const TRACK_SOURCE = {
      Microphone: 'microphone',
      ScreenShare: 'screen-video',
      ScreenShareAudio: 'screen-audio'
    };
    export const state = {
      outputMuted: false,
      peerId: 'self',
      peers: new Map(),
      screenSubscribedPeerIds: new Set(),
      serverPeerIds: new Set(),
      serverPeerSyncReady: false,
      viewedScreenPeerId: ''
    };
    export const livekitClientState = {
      resolvers: []
    };
    export const startUi = () => {};
    export const setVoiceConnectionStatus = () => {};
    export const showToast = () => {};
    export class ApiRequestError extends Error {
      constructor(message, code = '', roomId = '', status = 0) {
        super(message); this.code = code; this.roomId = roomId; this.status = status;
      }
    }
    export const postJson = async () => ({});
    export const queueAudioUnlock = () => {};
    export const syncRemoteAudioPlayback = () => {};
    export const clearPeerJoinCue = () => {};
    export const errorMessage = (error) => String(error);
    export const getScreenProfile = () => ({ id: 'balanced-30' });
    export const getScreenPublishVideoOptions = () => ({});
    export const loadLiveKitClient = () => new Promise((resolve) => {
      livekitClientState.resolvers.push(() => resolve({
        SubscriptionError: { SE_CODEC_UNSUPPORTED: 1 },
        VideoQuality: { HIGH: 2, LOW: 0 }
      }));
    });
    export const getScreenReceiverDemand = (peerId, viewedScreenPeerId, subscribedPeerIds) => {
      if (viewedScreenPeerId === peerId) return 'stage';
      if (subscribedPeerIds.has(peerId)) return 'preview';
      return 'hidden';
    };
    export const getScreenPublicationPresence = (publications, isVideo, isAudio) => {
      let hasAudio = false;
      let hasVideo = false;
      for (const publication of publications) {
        if (isVideo(publication)) hasVideo = true;
        if (isAudio(publication)) hasAudio = true;
      }
      return { active: hasVideo || hasAudio, hasAudio, hasVideo };
    };
    export const createScreenSubscriptionRetryController = () => ({
      clear() {},
      clearAll() {},
      schedule() {}
    });
    export const isCurrentRoomRecoveryEpoch = () => true;
    export const notifyLiveKitDisconnected = () => {};
    export const notifyLiveKitReconciled = () => {};
    export const notifyLiveKitReconnecting = () => {};
    export const setRoomRecoveryLiveKitAdapter = () => {};
    export const subscribeRoomRecoveryTransitions = () => () => {};
    export class ScreenRecoveryGraceController {
      beginGlobal() {}
      cancel() {}
      endGlobal() {}
      schedule() {}
      authoritativeStop() {}
    }
    export const createParticipant = (peerInfo) => {
      const existing = state.peers.get(peerInfo.id);
      if (existing) {
        if (Object.hasOwn(peerInfo, 'screen')) existing.screen = Boolean(peerInfo.screen);
        if (Object.hasOwn(peerInfo, 'screenAudio')) existing.screenAudio = Boolean(peerInfo.screenAudio);
        return existing;
      }
      const peer = { ...peerInfo, screen: Boolean(peerInfo.screen), screenAudio: Boolean(peerInfo.screenAudio) };
      state.peers.set(peer.id, peer);
      return peer;
    };
    export const applyRemoteScreenCue = () => {};
    export const attachRemoteScreenStream = () => {};
    export const attachRemoteTrack = () => {};
    export const ensureRemoteAudioElement = () => null;
    export const detachLiveKitParticipant = () => {};
    export const detachRemoteAudioTrack = () => {};
    export const detachRemoteScreen = () => {};
    export const detachRemoteScreenAudioTrack = () => {};
    export const detachRemoteScreenVideoTrack = () => {};
    export const detachRemoteScreenVideoTracks = () => {};
    export const refreshParticipantState = () => {};
    export const removePeer = () => {};
    export const setParticipantSpeaking = () => {};
    export const updateParticipant = () => {};
    export const updatePeerStatus = () => {};
    export const refreshScreenAction = () => {};
    export const refreshScreenStage = () => {};
    export const refreshScreenTiles = () => {};
  `);
  const path = 'src/lib/features/room/client/services/livekit-service.ts';
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
    service: await import(moduleUrl(output)),
    livekitClientState: (await import(stubUrl)).livekitClientState,
    state: (await import(stubUrl)).state
  };
}

test('participant resync preserves screen demand while only screen audio remains published', async () => {
  const { service, state } = await loadLiveKitService();
  const existing = {
    id: 'peer-audio-gap',
    screen: true,
    screenAudio: true,
    voiceIssue: ''
  };
  state.peers.set(existing.id, existing);
  state.viewedScreenPeerId = existing.id;
  state.screenSubscribedPeerIds.add(existing.id);

  const screenAudioPublication = {
    isMuted: false,
    source: 'screen-audio',
    trackSid: 'screen-audio-sid'
  };
  const participant = {
    identity: existing.id,
    isLocal: false,
    isScreenShareEnabled: false,
    joinedAt: new Date(0),
    name: 'Audio gap sender',
    trackPublications: new Map([[screenAudioPublication.trackSid, screenAudioPublication]])
  };

  const synced = service.syncLiveKitParticipant(participant);

  assert.equal(synced, existing);
  assert.equal(existing.screen, true);
  assert.equal(existing.screenAudio, true);
  assert.equal(existing.livekitParticipant, participant);
  assert.equal(state.viewedScreenPeerId, existing.id);
  assert.equal(state.screenSubscribedPeerIds.has(existing.id), true);
});

test('async quality demand ignores a screen publication replaced under the same SID', async () => {
  const { livekitClientState, service, state } = await loadLiveKitService();
  const qualityCalls = [];
  const stalePublication = {
    isDesired: false,
    isSubscribed: false,
    setSubscribed(subscribed) {
      this.isDesired = subscribed;
    },
    setVideoQuality(quality) {
      qualityCalls.push(quality);
    },
    source: 'screen-video',
    trackSid: 'screen-video-sid'
  };
  const participant = {
    identity: 'peer-republished',
    isLocal: false,
    isScreenShareEnabled: true,
    joinedAt: new Date(0),
    name: 'Republished sender',
    trackPublications: new Map([[stalePublication.trackSid, stalePublication]])
  };
  state.viewedScreenPeerId = participant.identity;

  const peer = service.syncLiveKitParticipant(participant);
  assert.equal(livekitClientState.resolvers.length, 1);

  participant.trackPublications.set(stalePublication.trackSid, {
    ...stalePublication,
    setVideoQuality() {
      throw new Error('replacement quality is handled by its own demand sync');
    }
  });
  livekitClientState.resolvers.shift()();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(peer.livekitParticipant, participant);
  assert.deepEqual(qualityCalls, []);
});
