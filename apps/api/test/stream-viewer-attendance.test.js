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
    viewedScreenPeerId: '',
    ...overrides
  };
}

function createRuntime(room, broadcasts) {
  const store = {
    async getRoom() { return null; },
    async listSummaryRecipientUserIds() { return []; }
  };
  return createRoomRealtimeRuntime({
    presenceRooms: new Map([[room.id, room]]),
    wsRegistry: {
      roomDetailSubscribers() { return []; },
      sendToConnection() {},
      sendToUser() {}
    },
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
    queueRoomOccupancyTransition: async () => {},
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
    { activeVoice: { roomId: ROOM_ID, peerId: OWNER_ID } },
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
    { activeVoice: { roomId: ROOM_ID, peerId: VIEWER_ID } },
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
