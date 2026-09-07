// The shared-music media lane in livekit-service.ts.
//
// The failure mode this file exists to catch is silent: a bot that is never
// subscribed raises no error anywhere, it just produces no sound. The other
// half is the opposite mistake — letting the bot become a peer, which would put
// it in the participant list and the stage tiles and, because the peer prune
// runs on every room snapshot, would create and destroy it in a loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

// `logLiveKitTransition` reads `window.location.hostname`; a non-local hostname
// keeps the service's debug logging out of the test output.
globalThis.window = { location: { hostname: 'voiceroom.test' } };

function transpile(path) {
  return ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
}

// The real bounded-retry controller, not a stub: the point of these tests is
// that the music lane's recovery is genuinely bounded and genuinely recovers,
// which a stubbed controller cannot demonstrate.
const retryModule = await import(
  moduleUrl(transpile('src/lib/features/room/client/media/screen-subscription-retry.ts'))
);

/** Deterministic replacement for window.setTimeout, so retries are drivable. */
function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    /** Fires every timer pending right now. One retry attempt takes two flushes. */
    flush() {
      const due = [...timers.entries()];
      for (const [id, timer] of due) {
        if (timers.delete(id)) timer.callback();
      }
      return due.length;
    }
  };
}

globalThis.__createTimerHarness = createTimerHarness;
globalThis.__createRetryController = retryModule.createScreenSubscriptionRetryController;
/** Attempt cap of the shared controller — the music budget is the same one. */
const RETRY_ATTEMPT_CAP = retryModule.SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS.length;

/** Drives one full retry attempt: the delay timer, then the response window. */
function runRetryAttempt(timers) {
  const fired = timers.flush();
  timers.flush();
  return fired > 0;
}

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

let harnessSequence = 0;

async function loadLiveKitService() {
  // Node caches modules by URL, and a data: URL is its own content. Without a
  // per-harness nonce every test would share one stub module — and therefore one
  // `state` object and one set of recorders.
  const stubUrl = moduleUrl(`
    export const harnessId = ${++harnessSequence};
    export const MICROPHONE_AUDIO_BITRATE = 64_000;
    export const SCREEN_AUDIO_BITRATE = 192_000;
    // The real values from client/media/livekit-runtime.ts, so the fixture below
    // is a genuine ScreenShareAudio publication: if the identity branch were
    // removed, the track would fall into the screen-share paths for real.
    export const TRACK_SOURCE = {
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio'
    };
    export const ROOM_EVENT = {
      Connected: 'connected',
      Reconnecting: 'reconnecting',
      Reconnected: 'reconnected',
      Disconnected: 'disconnected',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      SignalReconnecting: 'signalReconnecting',
      SignalConnected: 'signalConnected',
      LocalTrackPublished: 'localTrackPublished',
      LocalTrackUnpublished: 'localTrackUnpublished',
      TrackSubscriptionFailed: 'trackSubscriptionFailed',
      AudioPlaybackStatusChanged: 'audioPlaybackStatusChanged',
      LocalAudioSilenceDetected: 'localAudioSilenceDetected',
      TrackPublished: 'trackPublished',
      TrackUnpublished: 'trackUnpublished',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
      ConnectionQualityChanged: 'connectionQualityChanged',
      ParticipantNameChanged: 'participantNameChanged'
    };
    export const state = {
      audioUnlockPending: false,
      connecting: false,
      joined: true,
      livekitRoom: null,
      localMicPublication: null,
      localScreenPublications: new Map(),
      localScreenStream: null,
      localStream: null,
      muted: false,
      musicBotIdentity: '',
      outputMuted: false,
      peerId: 'self',
      peers: new Map(),
      roomId: 'room-1',
      screenSubscribedPeerIds: new Set(),
      serverPeerIds: new Set(),
      serverPeerSyncReady: false,
      sessionToken: 'token',
      viewedScreenPeerId: '',
      voiceConnection: 'idle'
    };
    export const musicCalls = { attached: [], detached: [], trackId: '' };
    export const timers = globalThis.__createTimerHarness();
    export const screenAttachments = [];
    export const detachedScreens = [];
    export const fakeRooms = [];

    export class Room {
      constructor() {
        this.handlers = new Map();
        this.remoteParticipants = new Map();
        this.canPlaybackAudio = true;
        this.localParticipant = {
          trackPublications: new Map(),
          publishTrack: async () => ({
            source: 'microphone',
            track: { id: 'local-mic' },
            mute: async () => {},
            unmute: async () => {}
          }),
          unpublishTrack: async () => {}
        };
        fakeRooms.push(this);
      }
      on(event, handler) {
        this.handlers.set(event, handler);
        return this;
      }
      emit(event, ...args) {
        const handler = this.handlers.get(event);
        if (!handler) throw new Error('no handler bound for ' + event);
        handler(...args);
      }
      async connect() {}
      async disconnect() {}
      removeAllListeners() {}
    }

    export const loadLiveKitClient = async () => ({
      Room,
      RoomEvent: ROOM_EVENT,
      SubscriptionError: { SE_CODEC_UNSUPPORTED: 1 },
      VideoQuality: { HIGH: 2, LOW: 0 }
    });

    // Mirrors the real module closely enough for the retry controller's
    // isAttached() probe to mean something: the lane holds at most one track,
    // and a targeted detach only fires when the id matches.
    export const attachMusicTrack = (track) => {
      musicCalls.attached.push(track);
      musicCalls.trackId = track.id;
    };
    export const detachMusicTrack = (trackId = '') => {
      if (trackId && musicCalls.trackId !== trackId) return;
      musicCalls.detached.push(trackId);
      musicCalls.trackId = '';
    };
    export const getMusicTrackId = () => musicCalls.trackId;

    export const startUi = { soundButtonVisible: false };
    export const setVoiceConnectionStatus = () => {};
    export const showToast = () => {};
    export class ApiRequestError extends Error {
      constructor(message, code = '', roomId = '', status = 0) {
        super(message); this.code = code; this.roomId = roomId; this.status = status;
      }
    }
    export const postJson = async () => ({ token: 'lk-token', url: 'ws://livekit.test' });
    export const queueAudioUnlock = () => {};
    export const syncRemoteAudioPlayback = () => {};
    export const clearPeerJoinCue = () => {};
    export const errorMessage = (error) => String(error);
    export const getScreenProfile = () => ({ id: 'balanced-30' });
    export const getScreenPublishVideoOptions = () => ({});
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
    // The REAL controller, on a deterministic clock. A stubbed one cannot show
    // that the music lane's recovery is both bounded and actually recovers.
    export const createScreenSubscriptionRetryController = () =>
      globalThis.__createRetryController({
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
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
    export class LiveKitReconcileGeneration {
      capture() { return 0; }
      invalidate() { return 1; }
      isCurrent() { return true; }
    }
    export const createParticipant = (peerInfo) => {
      const existing = state.peers.get(peerInfo.id);
      if (existing) return existing;
      const peer = {
        ...peerInfo,
        audioElements: new Map(),
        screen: Boolean(peerInfo.screen),
        screenAudio: Boolean(peerInfo.screenAudio)
      };
      state.peers.set(peer.id, peer);
      return peer;
    };
    export const applyRemoteScreenCue = () => {};
    export const attachRemoteScreenStream = (peer, stream) => {
      screenAttachments.push({ peerId: peer.id, stream });
      peer.screen = true;
    };
    export const attachRemoteTrack = () => {};
    export const ensureRemoteAudioElement = () => null;
    export const detachLiveKitParticipant = () => {};
    export const detachRemoteAudioTrack = () => {};
    export const detachRemoteScreen = (peer) => { detachedScreens.push(peer.id); };
    export const detachRemoteScreenAudioTrack = () => {};
    export const detachRemoteScreenVideoTrack = () => {};
    export const detachRemoteScreenVideoTracks = () => {};
    export const refreshParticipantState = () => {};
    export const removePeer = (peerId) => { state.peers.delete(peerId); };
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
  const stub = await import(stubUrl);
  return {
    service: await import(moduleUrl(output)),
    events: stub.ROOM_EVENT,
    fakeRooms: stub.fakeRooms,
    musicCalls: stub.musicCalls,
    timers: stub.timers,
    screenAttachments: stub.screenAttachments,
    state: stub.state
  };
}

function audioTrack(id) {
  return { id, kind: 'audio', readyState: 'live', addEventListener() {} };
}

function musicPublication(trackSid, track) {
  return {
    isDesired: false,
    isMuted: false,
    isSubscribed: false,
    // livekit-rtc has no "music" source, so the bot publishes on
    // TrackSource.SCREEN_SHARE_AUDIO. Everything here must still stay out of the
    // screen paths, which is what the identity branch buys.
    source: 'screen_share_audio',
    trackSid,
    track: track ? { mediaStreamTrack: track, mediaStream: null } : null,
    setSubscribed(subscribed) {
      this.isDesired = subscribed;
      this.isSubscribed = subscribed;
    }
  };
}

function botParticipant(identity, publications) {
  return {
    identity,
    isLocal: false,
    isScreenShareEnabled: false,
    joinedAt: new Date(0),
    name: identity,
    trackPublications: new Map(publications.map((publication) => [publication.trackSid, publication]))
  };
}

async function connectedRoom(harness) {
  harness.state.localStream = { getAudioTracks: () => [{ id: 'local-mic', kind: 'audio' }] };
  const connected = await harness.service.connectLiveKitRoom('self');
  assert.equal(connected, true);
  const room = harness.fakeRooms.at(-1);
  assert.equal(harness.state.livekitRoom, room);
  // Connecting runs one reconcile pass with no bot identity yet; the recorders
  // start from the state a client is actually in when the identity arrives.
  harness.musicCalls.attached.length = 0;
  harness.musicCalls.detached.length = 0;
  return room;
}

test('the music bot is subscribed but never becomes a peer, a tile, or a screen share', async () => {
  const harness = await loadLiveKitService();
  const { musicCalls, screenAttachments, service, state } = harness;

  const track = audioTrack('music-track-1');
  const publication = musicPublication('music-sid-1', track);
  const bot = botParticipant('music-bot', [publication]);
  const speaker = {
    identity: 'peer-1',
    isLocal: false,
    isScreenShareEnabled: false,
    joinedAt: new Date(0),
    name: 'Peer One',
    trackPublications: new Map()
  };

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  room.remoteParticipants.set(speaker.identity, speaker);
  state.serverPeerIds = new Set(['peer-1']);
  state.serverPeerSyncReady = true;
  state.musicBotIdentity = 'music-bot';

  service.syncLiveKitParticipants(room);

  // The peer map is what the participant list and the stage tiles render from.
  assert.equal(state.peers.has('music-bot'), false);
  assert.equal(state.peers.has('peer-1'), true);
  // ScreenShareAudio from the bot must not reach any screen-share path.
  assert.deepEqual(screenAttachments, []);
  assert.equal(state.peers.get('peer-1').screen, false);
  // ...and it must be subscribed and attached to the music lane.
  assert.equal(publication.isDesired, true);
  assert.ok(musicCalls.attached.length > 0);
  assert.ok(musicCalls.attached.every((attached) => attached === track));
});

test('repeated snapshots neither churn the lane nor materialize the bot', async () => {
  const harness = await loadLiveKitService();
  const { musicCalls, service, state } = harness;

  const track = audioTrack('music-track-1');
  const publication = musicPublication('music-sid-1', track);
  const bot = botParticipant('music-bot', [publication]);

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  state.serverPeerIds = new Set();
  state.serverPeerSyncReady = true;
  state.musicBotIdentity = 'music-bot';

  // `syncLiveKitParticipants` runs on every room snapshot; the peer prune is its
  // first statement. A bot that was a peer would be destroyed and rebuilt here.
  service.syncLiveKitParticipants(room);
  service.syncLiveKitParticipants(room);
  service.syncLiveKitParticipants(room);

  assert.equal(state.peers.size, 0);
  assert.deepEqual(musicCalls.detached, []);
  assert.ok(musicCalls.attached.length > 0);
  assert.ok(musicCalls.attached.every((attached) => attached === track));
});

test('reconcile picks up a publication that existed before this client connected', async () => {
  const harness = await loadLiveKitService();
  const { musicCalls, service, state } = harness;

  const track = audioTrack('music-track-1');
  const publication = musicPublication('music-sid-1', track);
  const bot = botParticipant('music-bot', [publication]);

  // The client connects with autoSubscribe:false, so no TrackPublished event is
  // ever delivered for this publication: only the reconcile pass can find it.
  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  assert.deepEqual(musicCalls.attached, []);

  // The identity arrives over the app WebSocket, after the LiveKit connect.
  service.setMusicBotIdentity('music-bot');
  assert.equal(publication.isDesired, true);
  assert.deepEqual(musicCalls.attached, [track]);

  // Idempotent: repeating it re-subscribes nothing and tears nothing down.
  const subscribeCalls = [];
  publication.setSubscribed = (subscribed) => subscribeCalls.push(subscribed);
  service.reconcileMusicPublication();
  service.reconcileMusicPublication();
  assert.deepEqual(subscribeCalls, []);
  assert.deepEqual(musicCalls.detached, []);
  assert.equal(musicCalls.attached.length, 3);
  assert.ok(musicCalls.attached.every((attached) => attached === track));
  assert.equal(state.peers.size, 0);
});

test('local output mute unsubscribes voice but never the music lane', async () => {
  const harness = await loadLiveKitService();
  const { service, state } = harness;

  const musicTrack = audioTrack('music-track-1');
  const music = musicPublication('music-sid-1', musicTrack);
  const bot = botParticipant('music-bot', [music]);
  const microphone = {
    isDesired: true,
    isMuted: false,
    isSubscribed: true,
    source: 'microphone',
    trackSid: 'mic-sid-1',
    track: null,
    setSubscribed(subscribed) {
      this.isDesired = subscribed;
      this.isSubscribed = subscribed;
    }
  };
  const speaker = {
    identity: 'peer-1',
    isLocal: false,
    isScreenShareEnabled: false,
    joinedAt: new Date(0),
    name: 'Peer One',
    trackPublications: new Map([[microphone.trackSid, microphone]])
  };

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  room.remoteParticipants.set(speaker.identity, speaker);
  state.serverPeerIds = new Set(['peer-1']);
  state.serverPeerSyncReady = true;
  state.musicBotIdentity = 'music-bot';
  service.syncLiveKitParticipants(room);
  assert.equal(music.isDesired, true);

  // Deafen. The microphone subscription policy must not be reused for music:
  // an unsubscribe would cost seconds of latency on unmute.
  state.outputMuted = true;
  service.syncLiveKitParticipants(room);
  service.syncLiveKitVoiceSubscriptions();

  assert.equal(microphone.isDesired, false);
  assert.equal(music.isDesired, true);
});

test('a track change keeps the lane, and only the bot leaving tears it down', async () => {
  const harness = await loadLiveKitService();
  const { events, musicCalls, service, state } = harness;

  const firstTrack = audioTrack('music-track-1');
  const first = musicPublication('music-sid-1', firstTrack);
  const bot = botParticipant('music-bot', [first]);

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  state.musicBotIdentity = 'music-bot';
  service.reconcileMusicPublication();
  assert.deepEqual(musicCalls.attached, [firstTrack]);

  // Track ends: unpublished, then the next one is published. Neither event may
  // reach the screen retry controller, and neither may reset the lane's
  // identity — local mute has to survive this.
  room.emit(events.TrackUnpublished, first, bot);
  bot.trackPublications.delete(first.trackSid);
  assert.deepEqual(musicCalls.detached, ['music-track-1']);

  const secondTrack = audioTrack('music-track-2');
  const second = musicPublication('music-sid-2', secondTrack);
  bot.trackPublications.set(second.trackSid, second);
  room.emit(events.TrackPublished, second, bot);

  assert.equal(second.isDesired, true);
  assert.deepEqual(musicCalls.attached, [firstTrack, secondTrack]);
  assert.equal(state.musicBotIdentity, 'music-bot');
  assert.equal(state.peers.size, 0);

  // The bot leaving is the one thing that does tear the whole lane down.
  room.emit(events.ParticipantDisconnected, bot);
  assert.deepEqual(musicCalls.detached, ['music-track-1', '']);
});

test('a subscribed music track is attached from the subscription event, not a screen branch', async () => {
  const harness = await loadLiveKitService();
  const { events, musicCalls, screenAttachments, service, state } = harness;

  const track = audioTrack('music-track-1');
  const publication = musicPublication('music-sid-1', track);
  const bot = botParticipant('music-bot', [publication]);

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  state.musicBotIdentity = 'music-bot';
  service.setMusicBotIdentity('music-bot');
  musicCalls.attached.length = 0;

  room.emit(events.TrackSubscribed, { mediaStreamTrack: track, mediaStream: null }, publication, bot);
  assert.deepEqual(musicCalls.attached, [track]);
  assert.deepEqual(screenAttachments, []);
  assert.equal(state.peers.size, 0);

  room.emit(events.TrackUnsubscribed, { mediaStreamTrack: track, mediaStream: null }, publication, bot);
  assert.deepEqual(musicCalls.detached, ['music-track-1']);
});

/** A bot whose publication is desired but never delivers a track. */
async function failingSubscriptionHarness() {
  const harness = await loadLiveKitService();
  const publication = musicPublication('music-sid-1', null);
  const bot = botParticipant('music-bot', [publication]);
  const subscribeCalls = [];
  publication.setSubscribed = (subscribed) => {
    subscribeCalls.push(subscribed);
    publication.isDesired = subscribed;
    // The subscription never completes: this is the silent failure.
    publication.isSubscribed = false;
  };

  const room = await connectedRoom(harness);
  room.remoteParticipants.set(bot.identity, bot);
  harness.state.musicBotIdentity = 'music-bot';
  return { ...harness, bot, publication, room, subscribeCalls };
}

test('a failed music subscription keeps retrying, bounded, instead of going silent forever', async () => {
  const { events, publication, room, subscribeCalls, timers } = await failingSubscriptionHarness();

  room.emit(events.TrackSubscriptionFailed, publication.trackSid, room.remoteParticipants.get('music-bot'), 0);
  assert.equal(subscribeCalls.length, 0, 'the retry is scheduled, not fired synchronously');

  // Each attempt is a resubscribe toggle. The previous implementation retried
  // once and then stopped, so a second failure meant permanent silence.
  for (let attempt = 1; attempt <= RETRY_ATTEMPT_CAP; attempt += 1) {
    runRetryAttempt(timers);
    assert.deepEqual(
      subscribeCalls.slice(-2),
      [false, true],
      `attempt ${attempt} should resubscribe`
    );
  }
  assert.equal(subscribeCalls.length, RETRY_ATTEMPT_CAP * 2);

  // ...and then it stops. A hard failure must not spin forever.
  assert.equal(timers.pending(), 0);
  runRetryAttempt(timers);
  assert.equal(subscribeCalls.length, RETRY_ATTEMPT_CAP * 2);
});

test('the 2s position heartbeat drives recovery without becoming a subscribe storm', async () => {
  const { publication, service, subscribeCalls, timers } = await failingSubscriptionHarness();

  // reconcileMusicPublication runs on every heartbeat. Twenty heartbeats with no
  // clock advance must not queue twenty resubscribes.
  for (let beat = 0; beat < 20; beat += 1) service.reconcileMusicPublication();
  assert.equal(subscribeCalls.length, 1, 'only the initial setSubscribed(true)');
  assert.equal(publication.isDesired, true);
  assert.ok(timers.pending() <= 1, 'at most one attempt in flight per SID');

  // Advancing the clock spends the budget, and no further.
  for (let attempt = 0; attempt < RETRY_ATTEMPT_CAP + 3; attempt += 1) {
    for (let beat = 0; beat < 5; beat += 1) service.reconcileMusicPublication();
    runRetryAttempt(timers);
  }
  assert.equal(subscribeCalls.length, 1 + RETRY_ATTEMPT_CAP * 2);
});

test('a retry that succeeds attaches the track and stops retrying', async () => {
  const { events, musicCalls, publication, room, subscribeCalls, timers } = await failingSubscriptionHarness();
  const bot = room.remoteParticipants.get('music-bot');

  room.emit(events.TrackSubscriptionFailed, publication.trackSid, bot, 0);

  // The bot's track arrives on the first retry.
  const track = audioTrack('music-track-1');
  publication.setSubscribed = (subscribed) => {
    subscribeCalls.push(subscribed);
    publication.isDesired = subscribed;
    publication.isSubscribed = subscribed;
    if (subscribed) publication.track = { mediaStreamTrack: track, mediaStream: null };
  };
  runRetryAttempt(timers);

  room.emit(events.TrackSubscribed, { mediaStreamTrack: track, mediaStream: null }, publication, bot);
  assert.deepEqual(musicCalls.attached, [track]);
  assert.equal(musicCalls.trackId, 'music-track-1');

  // Budget released, nothing left pending.
  const settled = subscribeCalls.length;
  timers.flush();
  timers.flush();
  assert.equal(subscribeCalls.length, settled);
  assert.equal(timers.pending(), 0);
});

test('a reconnect makes an exhausted music retry budget eligible again', async () => {
  const { events, publication, room, subscribeCalls, timers } = await failingSubscriptionHarness();
  const bot = room.remoteParticipants.get('music-bot');

  room.emit(events.TrackSubscriptionFailed, publication.trackSid, bot, 0);
  for (let attempt = 0; attempt < RETRY_ATTEMPT_CAP; attempt += 1) runRetryAttempt(timers);
  const exhausted = subscribeCalls.length;
  runRetryAttempt(timers);
  assert.equal(subscribeCalls.length, exhausted, 'budget is spent');

  // A reconnect is a new transport epoch. Without clearing the budget a
  // transient outage longer than the retry window strands the music until the
  // bot republishes under a new SID.
  room.emit(events.Reconnected);
  await new Promise((settle) => setImmediate(settle));

  runRetryAttempt(timers);
  assert.ok(subscribeCalls.length > exhausted, 'the reconnect re-armed the budget');
});

test('the bot never acquires a peer record from the subscription failure path', async () => {
  const { events, publication, room, state, timers } = await failingSubscriptionHarness();

  room.emit(events.TrackSubscriptionFailed, publication.trackSid, room.remoteParticipants.get('music-bot'), 0);
  for (let attempt = 0; attempt < RETRY_ATTEMPT_CAP; attempt += 1) runRetryAttempt(timers);

  assert.equal(state.peers.size, 0);
});
