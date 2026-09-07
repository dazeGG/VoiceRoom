// Local music playback: the audio element, the audio bus routing, and the two
// client-only listening preferences.
//
// AC-5 is the contract under test here: muting the music must emit no outgoing
// realtime message, must not unsubscribe anything, and must survive a change of
// track. All three are properties of *how* the preference is applied — as gain
// on the 'media' bus — so they are asserted on the routing calls themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function transpile(path, stubUrl) {
  const source = read(path)
    .replace(/from '[^']+'/g, `from '${stubUrl}'`)
    .replace(/import\('[^']+'\)/g, `import('${stubUrl}')`);
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
}

// --- Minimal DOM and MediaStream ------------------------------------------

class TestMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getTracks() {
    return [...this.tracks];
  }
}

class TestAudioElement {
  constructor() {
    this.srcObject = null;
    this.autoplay = false;
    this.muted = false;
    this.volume = 1;
    this.isConnected = false;
    this.paused = true;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  remove() {
    this.isConnected = false;
    document.body.children = document.body.children.filter((child) => child !== this);
  }
}

globalThis.MediaStream = TestMediaStream;
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'audio');
    return new TestAudioElement();
  },
  body: {
    children: [],
    append(element) {
      element.isConnected = true;
      this.children.push(element);
    }
  }
};

// --- media-playback-service -----------------------------------------------

let playbackSequence = 0;

async function loadMusicPlayback() {
  const stubUrl = moduleUrl(`
    export const harnessId = ${++playbackSequence};
    export const MAX_STREAM_VOLUME = 2;
    // One source of truth for both the UI and the routing, so the slider cannot
    // show a value the gain node is not applying.
    export const musicPreferences = { muted: false, volume: 0.5 };
    export const preferences = musicPreferences;
    export const routingCalls = [];
    export const releasedElements = [];
    export const appState = { outputMuted: false, localAppAudioSuppressed: false, peers: new Map() };
    export const state = appState;
    export const startUi = { soundButtonVisible: false };
    export const getParticipantAudioPreference = () => ({ muted: false, volume: 1 });
    export const getParticipantAudioPreferenceKey = () => 'peer:x';
    export const getMicrophoneProcessors = () => [];
    export const setVoiceConnectionStatus = () => {};
    export const getSharedAudioContext = () => ({ state: 'running' });
    export const releaseMediaStreamElement = (element) => { releasedElements.push(element); };
    export const routeMediaStreamElement = (element, kind, options) => {
      routingCalls.push({ element, kind, muted: options.muted, volume: options.volume });
      return true;
    };
    export const syncScreenVideoAudio = () => {};
    export const syncAudioBusOutput = async () => true;
    export const syncAudioBusSettings = () => {};
    export const unlockAudioBus = async () => {};
  `);
  const output = transpile('src/lib/features/room/client/services/media-playback-service.ts', stubUrl);
  const stub = await import(stubUrl);
  return {
    playback: await import(moduleUrl(output)),
    musicPreferences: stub.musicPreferences,
    releasedElements: stub.releasedElements,
    routingCalls: stub.routingCalls,
    appState: stub.appState
  };
}

function liveAudioTrack(id) {
  const listeners = [];
  return {
    id,
    kind: 'audio',
    readyState: 'live',
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    end() {
      this.readyState = 'ended';
      for (const listener of listeners) {
        if (listener.type === 'ended') listener.handler();
      }
    }
  };
}

test('the music element routes to the media bus, never to voice', async () => {
  const { playback, routingCalls } = await loadMusicPlayback();

  playback.attachMusicTrack(liveAudioTrack('music-1'));

  assert.equal(routingCalls.length, 1);
  // Screen-share audio uses 'media' too. On 'voice' the voice master gain would
  // also scale the music, and per-listener music volume would stop being
  // independent of the voice controls.
  assert.equal(routingCalls[0].kind, 'media');
  assert.equal(routingCalls[0].muted, false);
  assert.equal(routingCalls[0].volume, 0.5);
  assert.ok(playback.getMusicAudioElement());
  assert.equal(playback.getMusicTrackId(), 'music-1');
});

test('local mute is gain on the existing element and survives a track change', async () => {
  const { musicPreferences, playback, routingCalls } = await loadMusicPlayback();

  const first = liveAudioTrack('music-1');
  playback.attachMusicTrack(first);
  const element = playback.getMusicAudioElement();

  musicPreferences.muted = true;
  playback.syncMusicAudioPlayback();

  // Muting reuses the same element and the same bus: no element is rebuilt, so
  // nothing about the subscription or the transport is touched.
  assert.equal(playback.getMusicAudioElement(), element);
  assert.equal(routingCalls.at(-1).kind, 'media');
  assert.equal(routingCalls.at(-1).muted, true);
  assert.equal(routingCalls.at(-1).element, element);

  // The track changes. The preference lives outside the element, so the new
  // track comes up muted without the user touching anything.
  const second = liveAudioTrack('music-2');
  playback.attachMusicTrack(second);
  assert.equal(playback.getMusicTrackId(), 'music-2');
  assert.notEqual(playback.getMusicAudioElement(), element);
  assert.equal(routingCalls.at(-1).muted, true);

  musicPreferences.muted = false;
  playback.syncMusicAudioPlayback();
  assert.equal(routingCalls.at(-1).muted, false);
  assert.equal(routingCalls.at(-1).volume, 0.5);
});

test('a zero volume mutes the gain, and deafen mutes music along with voice', async () => {
  const { appState, musicPreferences, playback, routingCalls } = await loadMusicPlayback();

  playback.attachMusicTrack(liveAudioTrack('music-1'));

  musicPreferences.volume = 0;
  playback.syncMusicAudioPlayback();
  assert.equal(routingCalls.at(-1).muted, true);

  musicPreferences.volume = 1.5;
  playback.syncMusicAudioPlayback();
  assert.equal(routingCalls.at(-1).muted, false);
  assert.equal(routingCalls.at(-1).volume, 1.5);

  appState.outputMuted = true;
  playback.syncPlaybackMuteState();
  assert.equal(routingCalls.at(-1).muted, true);
});

test('re-attaching the same track is a no-op, and detach only matches its own track', async () => {
  const { playback, releasedElements, routingCalls } = await loadMusicPlayback();

  const track = liveAudioTrack('music-1');
  playback.attachMusicTrack(track);
  const element = playback.getMusicAudioElement();
  const routedAfterFirst = routingCalls.length;

  playback.attachMusicTrack(track);
  assert.equal(playback.getMusicAudioElement(), element);
  assert.deepEqual(releasedElements, []);
  assert.equal(routingCalls.length, routedAfterFirst + 1);

  playback.detachMusicTrack('some-other-track');
  assert.equal(playback.getMusicAudioElement(), element);

  playback.detachMusicTrack('music-1');
  assert.equal(playback.getMusicAudioElement(), null);
  assert.equal(playback.getMusicTrackId(), '');
  assert.deepEqual(releasedElements, [element]);
});

test('an ended track tears its own lane down', async () => {
  const { playback } = await loadMusicPlayback();

  const track = liveAudioTrack('music-1');
  playback.attachMusicTrack(track);
  assert.ok(playback.getMusicAudioElement());

  track.end();
  assert.equal(playback.getMusicAudioElement(), null);
});

// --- room-music store -----------------------------------------------------

let storeSequence = 0;

async function loadRoomMusicStore() {
  const shared = await import('@voice-room/shared/room-music');
  globalThis.__roomMusicShared = shared;
  const stubUrl = moduleUrl(`
    export const harnessId = ${++storeSequence};
    const shared = globalThis.__roomMusicShared;
    export const buildMusicSession = shared.buildMusicSession;
    export const isMusicPositionStale = shared.isMusicPositionStale;
    export const isMusicErrorCode = shared.isMusicErrorCode;
    export const sent = [];
    export const musicSyncs = { count: 0 };
    export const botIdentities = [];
    export const stored = { muted: false, volume: 0.5 };
    export const state = { peerId: 'self', roomId: 'room-1' };
    // The single preference source the store now delegates to. The stored
    // object stands in for localStorage, so persistence stays provable.
    export const musicPreferences = { muted: stored.muted, volume: stored.volume };
    export const setMusicPreferenceMuted = (muted) => {
      stored.muted = Boolean(muted);
      musicPreferences.muted = stored.muted;
      return musicPreferences.muted;
    };
    export const setMusicPreferenceVolume = (volume) => {
      stored.volume = Math.min(2, Math.max(0, Number(volume)));
      musicPreferences.volume = stored.volume;
      return musicPreferences.volume;
    };
    export const syncMusicAudioPlayback = () => { musicSyncs.count += 1; };
    export const setMusicBotIdentity = (identity) => { botIdentities.push(identity); };
    export const enqueueRoomMusic = (roomId, link) => {
      const command = shared.normalizeMusicCommand('room.music.enqueue', { link });
      if (!command) return false;
      sent.push({ type: command.type, roomId, trackRef: command.trackRef });
      return true;
    };
    export const skipRoomMusic = (roomId, itemId) => {
      sent.push({ type: 'room.music.skip', roomId, itemId });
      return true;
    };
    export const removeRoomMusicItem = (roomId, itemId) => {
      sent.push({ type: 'room.music.remove', roomId, itemId });
      return true;
    };
    export const stopRoomMusic = (roomId) => {
      sent.push({ type: 'room.music.stop', roomId });
      return true;
    };
  `);
  const source = read('src/lib/features/room/room-music.svelte.ts')
    .replace(/from '[^']+'/g, `from '${stubUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: 'room-music.svelte.ts'
  }).outputText;
  // `$state` is a Svelte compiler rune; outside the compiler it is an identity
  // function over a plain object, which is all this store needs.
  const store = await import(moduleUrl(`const $state = (value) => value;\n${output}`));
  const stub = await import(stubUrl);
  return {
    store,
    sent: stub.sent,
    stored: stub.stored,
    musicSyncs: stub.musicSyncs,
    botIdentities: stub.botIdentities,
    musicPreferences: stub.musicPreferences,
    shared
  };
}

/** An active snapshot for a static room — the only shape that opens the player. */
function activeSnapshot(store, overrides = {}) {
  store.applyRoomMusicSnapshot({
    roomId: 'room-1',
    mode: 'active',
    room: { isStatic: true },
    music: { status: 'idle', queue: [], sessionEpoch: 1 },
    musicBotIdentity: '',
    musicIsMaster: false,
    ...overrides
  });
}

test('local mute and volume send nothing and persist on this client only', async () => {
  const { musicPreferences, musicSyncs, sent, store, stored } = await loadRoomMusicStore();

  store.setRoomMusicMuted(true);
  store.setRoomMusicVolume(1.25);
  store.toggleRoomMusicMuted();

  // AC-5: not one outgoing realtime message from either control.
  assert.deepEqual(sent, []);
  assert.equal(stored.muted, false);
  assert.equal(stored.volume, 1.25);
  // Each change re-applies gain on the existing element instead of resubscribing.
  assert.equal(musicSyncs.count, 3);
  // What the UI renders and what the routing applies are the same object, so
  // the slider cannot show a value the gain node is not using.
  assert.equal(store.musicPreferences, musicPreferences);
  assert.equal(store.musicPreferences.volume, 1.25);
  assert.equal(store.musicPreferences.muted, false);
});

test('the store keeps no second copy of the listening preferences', () => {
  const source = read('src/lib/features/room/room-music.svelte.ts');
  const panel = read('src/lib/features/room/components/RoomMusicPanel.svelte');

  // `roomMusic` must not carry muted/volume fields alongside the preference
  // module — that was two sources that agreed only by convention.
  const storeState = source.slice(source.indexOf('export const roomMusic'), source.indexOf('export function resetRoomMusic'));
  assert.doesNotMatch(storeState, /^\s*(?:muted|volume):/m);
  assert.doesNotMatch(`${source}\n${panel}`, /roomMusic\.(muted|volume)\b/);
  assert.match(panel, /musicPreferences\.(muted|volume)/);
});

test('the mute and volume path in the store never touches the realtime module', () => {
  const source = read('src/lib/features/room/room-music.svelte.ts');
  const localSection = source.slice(source.indexOf('export function setRoomMusicMuted'));
  const commandSection = localSection.slice(0, localSection.indexOf('// --- Permissions'));

  assert.match(commandSection, /setMusicPreferenceMuted/);
  assert.match(commandSection, /syncMusicAudioPlayback\(\)/);
  assert.doesNotMatch(commandSection, /enqueueRoomMusic|skipRoomMusic|removeRoomMusicItem|stopRoomMusic|\.send\(/);
});

test('an active snapshot installs the session, the bot identity, and master status', async () => {
  const { botIdentities, store } = await loadRoomMusicStore();

  activeSnapshot(store, {
    music: {
      status: 'playing',
      currentItem: null,
      positionMs: 1000,
      positionAt: Date.now(),
      queue: [],
      sessionEpoch: 4
    },
    musicBotIdentity: 'music-bot',
    musicIsMaster: true
  });

  assert.equal(store.roomMusic.isStatic, true);
  assert.equal(store.roomMusic.loaded, true);
  assert.equal(store.roomMusic.session.status, 'playing');
  assert.equal(store.roomMusic.session.sessionEpoch, 4);
  assert.equal(store.isRoomMusicVisible(), true);
  // Master is resolved server-side and delivered as a snapshot sibling: nothing
  // else on the wire carries the room's owner, so the client cannot derive it.
  assert.equal(store.isRoomMusicMaster(), true);
  // Pushed on every snapshot, not only on change: the reconcile pass behind it
  // is what finds a publication that predates this client's connection.
  assert.deepEqual(botIdentities, ['music-bot']);
});

test('a guest snapshot leaves master false and the master-only action unavailable', async () => {
  const { sent, store } = await loadRoomMusicStore();

  activeSnapshot(store, { musicBotIdentity: 'music-bot', musicIsMaster: false });

  assert.equal(store.isRoomMusicMaster(), false);
  assert.equal(store.stopRoomMusicPlayback(), false);
  assert.deepEqual(sent, []);
});

test('a preview snapshot and a temporary room leave no player and no lane', async () => {
  const previewHarness = await loadRoomMusicStore();
  previewHarness.store.applyRoomMusicSnapshot({
    roomId: 'room-1',
    mode: 'preview',
    room: { isStatic: true },
    music: { status: 'playing', queue: [], sessionEpoch: 2 },
    musicBotIdentity: 'music-bot',
    musicIsMaster: true
  });
  assert.equal(previewHarness.store.roomMusic.loaded, false);
  assert.equal(previewHarness.store.roomMusic.session.status, 'idle');
  assert.equal(previewHarness.store.isRoomMusicMaster(), false);
  assert.deepEqual(previewHarness.botIdentities, ['']);

  const temporaryHarness = await loadRoomMusicStore();
  temporaryHarness.store.applyRoomMusicSnapshot({
    roomId: 'room-1',
    mode: 'active',
    room: { isStatic: false },
    music: { status: 'playing', queue: [], sessionEpoch: 2 },
    musicBotIdentity: 'music-bot',
    musicIsMaster: true
  });
  assert.equal(temporaryHarness.store.isRoomMusicVisible(), false);
  assert.equal(temporaryHarness.store.roomMusic.loaded, false);
  assert.equal(temporaryHarness.store.isRoomMusicMaster(), false);
  assert.deepEqual(temporaryHarness.botIdentities, ['']);
});

test('neither music event is applied for another room', async () => {
  const { botIdentities, store } = await loadRoomMusicStore();

  activeSnapshot(store);
  botIdentities.length = 0;

  store.applyRoomMusicState({
    roomId: 'other-room',
    music: { status: 'playing', queue: [], sessionEpoch: 9 },
    musicBotIdentity: 'other-bot'
  });
  store.applyRoomMusicPosition({
    roomId: 'other-room',
    musicBotIdentity: 'other-bot',
    sessionEpoch: 9,
    itemId: null,
    positionMs: 4000,
    positionAt: Date.now()
  });

  assert.equal(store.roomMusic.session.sessionEpoch, 1);
  assert.deepEqual(botIdentities, []);
});

function queueItem(shared, id) {
  return {
    id,
    trackRef: shared.normalizeMusicLink('https://vkvideo.ru/video-1_77'),
    addedBy: 'peer-2',
    title: 'A',
    artist: 'B',
    coverUrl: null,
    durationMs: 200000
  };
}

test('a position heartbeat advances progress without re-sending the queue', async () => {
  const { botIdentities, shared, store } = await loadRoomMusicStore();

  const item = queueItem(shared, 'item-1');
  activeSnapshot(store, {
    music: {
      status: 'playing',
      currentItem: item,
      queue: [item],
      positionMs: 0,
      positionAt: Date.now(),
      sessionEpoch: 3
    },
    musicBotIdentity: 'music-bot'
  });
  botIdentities.length = 0;

  const positionAt = Date.now();
  store.applyRoomMusicPosition({
    roomId: 'room-1',
    musicBotIdentity: 'music-bot',
    sessionEpoch: 3,
    itemId: 'item-1',
    positionMs: 12000,
    positionAt
  });

  assert.equal(store.roomMusic.session.positionMs, 12000);
  assert.equal(store.roomMusic.session.positionAt, positionAt);
  assert.equal(store.roomMusic.session.queue.length, 1);
  assert.equal(store.roomMusic.session.currentItem.id, 'item-1');
  // The identity rides on the heartbeat too, so a client that missed a state
  // event still learns it.
  assert.deepEqual(botIdentities, ['music-bot']);
});

test('a heartbeat from a stale epoch or a replaced item does not rewind progress', async () => {
  const { shared, store } = await loadRoomMusicStore();

  const item = queueItem(shared, 'item-2');
  const positionAt = Date.now();
  activeSnapshot(store, {
    music: {
      status: 'playing',
      currentItem: item,
      queue: [],
      positionMs: 30000,
      positionAt,
      sessionEpoch: 5
    },
    musicBotIdentity: 'music-bot'
  });

  // Still in flight when the session restarted.
  store.applyRoomMusicPosition({
    roomId: 'room-1',
    musicBotIdentity: 'music-bot',
    sessionEpoch: 4,
    itemId: 'item-2',
    positionMs: 1000,
    positionAt: positionAt + 1000
  });
  // Still in flight when the track changed.
  store.applyRoomMusicPosition({
    roomId: 'room-1',
    musicBotIdentity: 'music-bot',
    sessionEpoch: 5,
    itemId: 'item-1',
    positionMs: 1000,
    positionAt: positionAt + 1000
  });

  assert.equal(store.roomMusic.session.positionMs, 30000);
  assert.equal(store.roomMusic.session.positionAt, positionAt);
});

test('a bot that left on its own initiative clears the identity from either event', async () => {
  // The bot leaves without the API asking it to on a 409/410 callback or five
  // unacknowledged heartbeats, so both events must be able to tear the lane down.
  const stateHarness = await loadRoomMusicStore();
  activeSnapshot(stateHarness.store, { musicBotIdentity: 'music-bot' });
  stateHarness.botIdentities.length = 0;
  stateHarness.store.applyRoomMusicState({
    roomId: 'room-1',
    music: { status: 'idle', queue: [], sessionEpoch: 2 },
    musicBotIdentity: null
  });
  assert.deepEqual(stateHarness.botIdentities, ['']);

  const positionHarness = await loadRoomMusicStore();
  activeSnapshot(positionHarness.store, { musicBotIdentity: 'music-bot' });
  positionHarness.botIdentities.length = 0;
  positionHarness.store.applyRoomMusicPosition({
    roomId: 'room-1',
    musicBotIdentity: null,
    sessionEpoch: 1,
    itemId: null,
    positionMs: 0,
    positionAt: null
  });
  assert.deepEqual(positionHarness.botIdentities, ['']);
});

test('skip and remove are offered to the author and to the master, stop only to the master', async () => {
  const { sent, store } = await loadRoomMusicStore();

  const mine = { id: 'item-1', addedBy: 'self', title: 'A', artist: 'B' };
  const theirs = { id: 'item-2', addedBy: 'peer-9', title: 'C', artist: 'D' };

  // Authorship is by peerId, matching the server: a guest has no account id, so
  // comparing accounts would make every guest the author of every guest's item.
  activeSnapshot(store, { musicIsMaster: false });
  assert.equal(store.canControlMusicItem(mine), true);
  assert.equal(store.canControlMusicItem(theirs), false);
  assert.equal(store.canControlMusicItem(null), false);
  assert.equal(store.stopRoomMusicPlayback(), false);
  assert.deepEqual(sent, []);

  activeSnapshot(store, { musicIsMaster: true });
  assert.equal(store.canControlMusicItem(theirs), true);
  assert.equal(store.stopRoomMusicPlayback(), true);
  assert.deepEqual(sent, [{ type: 'room.music.stop', roomId: 'room-1' }]);
});

test('a junk link is rejected before it reaches the wire', async () => {
  const { sent, store } = await loadRoomMusicStore();

  store.roomMusic.roomId = 'room-1';
  store.roomMusic.linkInput = 'https://example.com/not-music';
  assert.equal(store.submitRoomMusicLink(), false);
  assert.deepEqual(sent, []);
  assert.notEqual(store.roomMusic.error, '');
  assert.equal(store.roomMusic.linkInput, 'https://example.com/not-music');

  store.roomMusic.linkInput = 'https://youtu.be/dQw4w9WgXcQ';
  assert.equal(store.submitRoomMusicLink(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'room.music.enqueue');
  assert.equal(sent[0].roomId, 'room-1');
  assert.equal(sent[0].trackRef.id, 'youtube:video:dQw4w9WgXcQ');
  assert.equal(store.roomMusic.linkInput, '');
  assert.equal(store.roomMusic.error, '');
});

test('an unreachable source is not reported to the user as a bad link', async () => {
  const { shared, store } = await loadRoomMusicStore();

  // The whole point of the code: the link parsed against this same contract, so
  // the message must not send the user off editing it.
  assert.equal(store.applyRoomMusicError('source_unavailable'), true);
  const unreachable = store.roomMusic.error;
  assert.notEqual(unreachable, '');

  assert.equal(store.applyRoomMusicError('invalid_link'), true);
  assert.equal(store.roomMusic.error, store.MUSIC_LINK_HINT);
  assert.notEqual(unreachable, store.MUSIC_LINK_HINT);

  // Every code in the contract has a message; a missing one would show as blank.
  for (const code of shared.MUSIC_ERROR_CODES) {
    assert.equal(store.applyRoomMusicError(code), true, code);
    assert.notEqual(store.roomMusic.error, '', code);
  }

  // A non-music error belongs to the caller's generic handling, not the panel.
  store.roomMusic.error = '';
  assert.equal(store.applyRoomMusicError('join_failed'), false);
  assert.equal(store.roomMusic.error, '');
});

test('a stale heartbeat marks the position as not authoritative', async () => {
  const { shared, store } = await loadRoomMusicStore();

  store.roomMusic.session = shared.buildMusicSession({
    status: 'playing',
    positionMs: 5000,
    positionAt: Date.now(),
    queue: [],
    sessionEpoch: 1
  });
  assert.equal(store.isMusicPositionAuthoritative(), true);

  store.roomMusic.session = shared.buildMusicSession({
    status: 'playing',
    positionMs: 5000,
    positionAt: Date.now() - (shared.MUSIC_POSITION_STALE_MS + 1000),
    queue: [],
    sessionEpoch: 1
  });
  assert.equal(store.isMusicPositionAuthoritative(), false);
});
