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
    unregisterConnectionFromAllRooms() {},
    ...overrides.wsRegistry
  };
  return createRoomRealtimeRuntime({
    presenceRooms: overrides.presenceRooms || new Map([[room.id, room]]),
    wsRegistry,
    getRoomStore: () => store,
    getRoom: overrides.getRoom || (async () => room),
    publicPeer: (peer) => ({
      id: peer.id,
      name: peer.name,
      screen: peer.screen,
      viewedScreenPeerId: peer.viewedScreenPeerId
    }),
    publicLobbyRoom: (value) => value,
    publicChatMessage: (value) => value,
    broadcast: (_room, message) => broadcasts.push(structuredClone(message)),
    closePeer: overrides.closePeer || (() => {}),
    avatarColorForPeerId: () => 'blue',
    MAX_ROOM_PEERS: 16,
    tokensMatch: (expected, actual) => expected === actual,
    sessionAvatarColorKey: () => 'blue',
    queueRoomOccupancyTransition: overrides.queueRoomOccupancyTransition || (async () => {}),
    findRoomBan: overrides.findRoomBan || (async () => null)
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

test('older join cannot replace a newer join after a delayed room lookup', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  const roomLookups = [];
  const runtime = createRuntime(room, [], {
    getRoom: async () => new Promise((resolve) => roomLookups.push(resolve)),
    store: {
      async getRoom() { return { id: ROOM_ID, name: 'Room' }; },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const firstConnection = { activeVoice: null, previewRoomIds: new Set() };
  const secondConnection = { activeVoice: null, previewRoomIds: new Set() };
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (roomLookups.length < 2) await Promise.resolve();

  roomLookups[1](room);
  const secondResult = await secondJoin;
  roomLookups[0](room);
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(room.peers.get(OWNER_ID).transport.id, secondConnection.activeVoice.transportId);
});

test('initial join is announced even when a reconnect replaces it during occupancy persistence', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  const broadcasts = [];
  const occupancyTransitions = [];
  const runtime = createRuntime(room, broadcasts, {
    queueRoomOccupancyTransition: async () => new Promise((resolve) => occupancyTransitions.push(resolve)),
    store: {
      async getRoom() { return { id: ROOM_ID, name: 'Room' }; },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const firstConnection = { activeVoice: null, previewRoomIds: new Set() };
  const secondConnection = { activeVoice: null, previewRoomIds: new Set() };
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  while (occupancyTransitions.length < 1) await Promise.resolve();
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (occupancyTransitions.length < 2) await Promise.resolve();

  occupancyTransitions[1]();
  const secondResult = await secondJoin;
  occupancyTransitions[0]();
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.deepEqual(broadcasts.map((message) => message.type), ['peer-joined']);
});

test('explicit leave cancels a join before it can attach a peer', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  let releaseIdentity;
  const runtime = createRuntime(room, [], {
    store: {
      async getOrCreatePeerIdentity() {
        return new Promise((resolve) => { releaseIdentity = resolve; });
      }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const join = runtime.joinVoiceRoom(connection, payload, null);
  while (!releaseIdentity) await Promise.resolve();
  await runtime.leaveVoiceRoom(connection, payload);
  releaseIdentity({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const result = await join;

  assert.equal(result.code, 'superseded_join');
  assert.equal(connection.activeVoice, null);
  assert.equal(room.peers.size, 0);
});

test('connection cleanup cancels a join before it can create a ghost peer', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  let releaseIdentity;
  const runtime = createRuntime(room, [], {
    store: {
      async getOrCreatePeerIdentity() {
        return new Promise((resolve) => { releaseIdentity = resolve; });
      }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const join = runtime.joinVoiceRoom(connection, payload, null);
  while (!releaseIdentity) await Promise.resolve();
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseIdentity({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const result = await join;

  assert.equal(result.code, 'superseded_join');
  assert.equal(connection.activeVoice, null);
  assert.equal(room.peers.size, 0);
});

test('newer room join wins across different peer keys on one connection', async () => {
  const secondRoomId = 'room2';
  const secondPeerId = 'peer-owner2';
  const secondToken = 's'.repeat(32);
  const firstRoom = { id: ROOM_ID, peers: new Map() };
  const secondRoom = { id: secondRoomId, peers: new Map() };
  const rooms = new Map([[ROOM_ID, firstRoom], [secondRoomId, secondRoom]]);
  let releaseFirstIdentity;
  const runtime = createRuntime(firstRoom, [], {
    presenceRooms: rooms,
    getRoom: async (roomId) => rooms.get(roomId) || null,
    store: {
      async getRoom(roomId) {
        return rooms.has(roomId) ? { id: roomId, name: roomId } : null;
      },
      async getOrCreatePeerIdentity({ roomId }) {
        if (roomId === ROOM_ID) {
          return new Promise((resolve) => { releaseFirstIdentity = resolve; });
        }
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };

  const firstJoin = runtime.joinVoiceRoom(connection, {
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN
  }, null);
  while (!releaseFirstIdentity) await Promise.resolve();
  const secondResult = await runtime.joinVoiceRoom(connection, {
    roomId: secondRoomId,
    peerId: secondPeerId,
    sessionToken: secondToken
  }, null);
  releaseFirstIdentity({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(firstRoom.peers.size, 0);
  assert.equal(secondRoom.peers.get(secondPeerId).transport.id, connection.activeVoice.transportId);
  assert.equal(connection.activeVoice.roomId, secondRoomId);
});

test('same connection cannot leave an orphan when it changes peer id in one room', async () => {
  const secondPeerId = 'peer-owner2';
  const secondToken = 's'.repeat(32);
  const room = { id: ROOM_ID, peers: new Map() };
  const runtime = createRuntime(room, [], {
    closePeer: (roomId, peerId, transportId) => {
      const peer = roomId === ROOM_ID ? room.peers.get(peerId) : null;
      if (peer?.transport?.id === transportId) room.peers.delete(peerId);
    },
    store: {
      async getRoom() { return { id: ROOM_ID, name: 'Room' }; },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };

  const firstResult = await runtime.joinVoiceRoom(connection, {
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN
  }, null);
  const secondResult = await runtime.joinVoiceRoom(connection, {
    roomId: ROOM_ID,
    peerId: secondPeerId,
    sessionToken: secondToken
  }, null);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual([...room.peers.keys()], [secondPeerId]);
  assert.equal(connection.activeVoice.peerId, secondPeerId);
});

test('closed connection cannot subscribe after a delayed ban lookup', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  const subscribers = new Set();
  let releaseBanLookup;
  const runtime = createRuntime(room, [], {
    findRoomBan: async () => new Promise((resolve) => { releaseBanLookup = resolve; }),
    wsRegistry: {
      registerConnectionForRoom(connection) { subscribers.add(connection); },
      unregisterConnectionForRoom(connection) { subscribers.delete(connection); },
      unregisterConnectionFromAllRooms(connection) { subscribers.delete(connection); }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };

  const subscription = runtime.subscribePreview(connection, ROOM_ID);
  while (!releaseBanLookup) await Promise.resolve();
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseBanLookup(null);
  await subscription;

  assert.deepEqual([...connection.previewRoomIds], []);
  assert.equal(subscribers.has(connection), false);
});

test('closed connection rolls back preview subscription during snapshot build', async () => {
  const room = { id: ROOM_ID, peers: new Map() };
  const subscribers = new Set();
  const sentEnvelopes = [];
  let releaseRoomLookup;
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return new Promise((resolve) => { releaseRoomLookup = resolve; });
      }
    },
    wsRegistry: {
      registerConnectionForRoom(connection) { subscribers.add(connection); },
      sendToConnection(_connection, envelope) { sentEnvelopes.push(envelope); },
      unregisterConnectionForRoom(connection) { subscribers.delete(connection); },
      unregisterConnectionFromAllRooms(connection) { subscribers.delete(connection); }
    }
  });
  const connection = { activeVoice: null, closed: false, previewRoomIds: new Set() };

  const subscription = runtime.subscribePreview(connection, ROOM_ID);
  while (!releaseRoomLookup) await Promise.resolve();
  assert.equal(subscribers.has(connection), true);
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseRoomLookup({ id: ROOM_ID, name: 'Room' });
  await subscription;

  assert.deepEqual([...connection.previewRoomIds], []);
  assert.equal(subscribers.has(connection), false);
  assert.deepEqual(sentEnvelopes, []);
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
