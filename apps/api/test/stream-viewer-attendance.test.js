'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
} = require('../src/realtime/room-runtime');

const ROOM_ID = 'room1';
const OWNER_ID = 'peer-owner1';
const VIEWER_ID = 'peer-viewer1';
const OWNER_TOKEN = 'o'.repeat(32);
const VIEWER_TOKEN = 'v'.repeat(32);

function createPeer(id, overrides = {}) {
  return {
    id,
    name: id,
    screen: false,
    sessionToken: id === OWNER_ID ? OWNER_TOKEN : VIEWER_TOKEN,
    transport: { id: `transport-${id}` },
    viewedScreenPeerId: '',
    ...overrides
  };
}

function createRuntime(room, broadcasts, overrides = {}) {
  const store = {
    async getRoom() { return null; },
    async listMessages() { return []; },
    async listSummaryRecipientUserIds() { return []; },
    ...overrides.store
  };
  const wsRegistry = {
    registerConnectionForRoom() {},
    roomDetailSubscribers() { return []; },
    sendToConnection() {},
    sendToUser() {},
    unregisterConnectionForRoom() {},
    ...overrides.wsRegistry
  };
  return createRoomRealtimeRuntime({
    presenceRooms: new Map([[room.id, room]]),
    wsRegistry,
    getRoomStore: () => store,
    getRoom: async () => room,
    publicPeer: (peer) => ({
      id: peer.id,
      name: peer.name,
      screen: peer.screen,
      viewedScreenPeerId: peer.viewedScreenPeerId
    }),
    publicLobbyRoom: (value) => value,
    publicChatMessage: (value) => value,
    broadcast: (_room, message) => broadcasts.push(structuredClone(message)),
    closePeer() {},
    avatarColorForPeerId: () => 'blue',
    MAX_ROOM_PEERS: 16,
    tokensMatch: (expected, actual) => expected === actual,
    sessionAvatarColorKey: () => 'blue',
    queueRoomOccupancyTransition: overrides.queueRoomOccupancyTransition || (async () => {}),
    findRoomBan: async () => null
  });
}

test('attendance only accepts an active remote screen owner', () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID);
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner], [viewer.id, viewer]]) };

  assert.equal(resolveViewedScreenPeerId(room, viewer.id, owner.id), owner.id);
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, viewer.id), '');
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, 'missing-peer'), '');

  owner.screen = false;
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, owner.id), '');
});

test('owner removal clears every viewer that still references the stream', () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const otherViewer = createPeer('peer-viewer2', {
    sessionToken: 'w'.repeat(32),
    viewedScreenPeerId: OWNER_ID
  });
  const unrelated = createPeer('peer-viewer3', {
    sessionToken: 'x'.repeat(32),
    viewedScreenPeerId: 'peer-other1'
  });
  const room = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer],
      [otherViewer.id, otherViewer],
      [unrelated.id, unrelated]
    ])
  };

  room.peers.delete(owner.id);
  const cleared = clearViewedScreenPeerReferences(room, owner.id);

  assert.deepEqual(cleared.map((peer) => peer.id), [viewer.id, otherViewer.id]);
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.equal(otherViewer.viewedScreenPeerId, '');
  assert.equal(unrelated.viewedScreenPeerId, 'peer-other1');
});

test('screen stop publishes viewer leave and rejects a stale re-entry', async () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner], [viewer.id, viewer]]) };
  const broadcasts = [];
  const runtime = createRuntime(room, broadcasts);

  const stopped = await runtime.updatePeerState(
    { activeVoice: { roomId: ROOM_ID, peerId: OWNER_ID, transportId: owner.transport.id } },
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      patch: { screen: false }
    }
  );

  assert.equal(stopped.ok, true);
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.deepEqual(
    broadcasts.map((message) => [message.peer.id, message.peer.screen, message.peer.viewedScreenPeerId]),
    [
      [VIEWER_ID, false, ''],
      [OWNER_ID, false, '']
    ]
  );

  broadcasts.length = 0;
  const staleEntry = await runtime.updatePeerState(
    { activeVoice: { roomId: ROOM_ID, peerId: VIEWER_ID, transportId: viewer.transport.id } },
    {
      roomId: ROOM_ID,
      peerId: VIEWER_ID,
      sessionToken: VIEWER_TOKEN,
      patch: { viewedScreenPeerId: OWNER_ID }
    }
  );

  assert.equal(staleEntry.ok, true);
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.equal(broadcasts.at(-1).peer.viewedScreenPeerId, '');
});

test('superseded transport cannot stop the replacement peer stream', async () => {
  const owner = createPeer(OWNER_ID, { screen: true, transport: { id: 'new-transport' } });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner], [viewer.id, viewer]]) };
  const broadcasts = [];
  const runtime = createRuntime(room, broadcasts);

  const result = await runtime.updatePeerState(
    { activeVoice: { roomId: ROOM_ID, peerId: OWNER_ID, transportId: 'old-transport' } },
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      patch: { screen: false }
    }
  );

  assert.deepEqual(result, { ok: false, code: 'not_active_peer' });
  assert.equal(owner.screen, true);
  assert.equal(viewer.viewedScreenPeerId, OWNER_ID);
  assert.deepEqual(broadcasts, []);
});

test('newer concurrent join wins even when its identity lookup finishes first', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  const identityLookups = [];
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() { return { id: ROOM_ID, name: 'Room' }; },
      async getOrCreatePeerIdentity(request) {
        return new Promise((resolve) => identityLookups.push({ request, resolve }));
      }
    }
  });
  const firstConnection = { activeVoice: null, previewRoomIds: new Set() };
  const secondConnection = { activeVoice: null, previewRoomIds: new Set() };
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (identityLookups.length < 2) await Promise.resolve();

  const secondLookup = identityLookups.find(({ request }) => request.displayName === 'Second');
  secondLookup.resolve({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const secondResult = await secondJoin;

  const firstLookup = identityLookups.find(({ request }) => request.displayName === 'First');
  firstLookup.resolve({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(room.peers.get(OWNER_ID).transport.id, secondConnection.activeVoice.transportId);
});

test('snapshot reads presence after awaited message history', async () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner], [viewer.id, viewer]]) };
  let releaseMessages;
  const messagesPending = new Promise((resolve) => {
    releaseMessages = resolve;
  });
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() { return { id: ROOM_ID, name: 'Room' }; },
      async listMessages() { return messagesPending; }
    }
  });

  const snapshotPending = runtime.buildRoomSnapshot(ROOM_ID, 'active');
  await Promise.resolve();
  owner.screen = false;
  viewer.viewedScreenPeerId = '';
  releaseMessages([]);
  const snapshot = await snapshotPending;

  assert.equal(snapshot.peers.find((peer) => peer.id === OWNER_ID).screen, false);
  assert.equal(snapshot.peers.find((peer) => peer.id === VIEWER_ID).viewedScreenPeerId, '');
});
