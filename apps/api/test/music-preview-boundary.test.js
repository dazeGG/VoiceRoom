'use strict';

// The music queue and its authors must not reach the lobby. Gating the snapshot
// closes only half of that: `broadcastRoomDetail` delivers to preview
// subscribers by default, so incremental `room.music.*` events would still leak.
// Both paths are checked here, plus the permission cache the WS command path
// reads off the peer record.

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMusicCommand } = require('@voice-room/shared/room-music');
const { createRoomRealtimeRuntime } = require('../src/realtime/room-runtime');

const ROOM_ID = 'room-static';
const OWNER_ID = 'user-owner';

function createConnection(kind, { roomId = ROOM_ID, peerId = 'peer-1', transportId = 't-1' } = {}) {
  return {
    kind,
    closed: false,
    previewRoomIds: new Set(kind === 'preview' ? [roomId] : []),
    activeVoice: kind === 'active' ? { roomId, peerId, transportId } : null,
    received: []
  };
}

function createHarness({ isStatic = true, musicService = null, peers = new Map() } = {}) {
  const connections = [];
  const presenceRooms = new Map([[ROOM_ID, { id: ROOM_ID, peers, updatedAt: Date.now() }]]);
  const dbRoom = {
    id: ROOM_ID,
    name: 'Static',
    isStatic,
    ownerId: OWNER_ID,
    avatarKey: null,
    createdAt: 0,
    emptySince: null
  };
  const runtime = createRoomRealtimeRuntime({
    presenceRooms,
    wsRegistry: {
      roomDetailSubscribers: () => connections,
      sendToConnection: (connection, envelope) => connection.received.push(envelope),
      registerConnectionForRoom: () => {},
      unregisterConnectionForRoom: () => {},
      unregisterConnectionFromAllRooms: () => {}
    },
    getRoomStore: () => ({
      getRoom: async () => dbRoom,
      listMessages: async () => []
    }),
    getRoom: async () => dbRoom,
    publicPeer: (peer) => ({ id: peer.id }),
    publicLobbyRoom: (room) => ({ roomId: room.id, name: room.name, isStatic: room.isStatic }),
    publicChatMessage: (message) => message,
    getUserStore: null,
    broadcast: () => {},
    closePeer: () => {},
    avatarColorForPeerId: () => 'a',
    MAX_ROOM_PEERS: 10,
    tokensMatch: (a, b) => a === b,
    sessionAvatarColorKey: () => '',
    musicService
  });
  return { connections, runtime };
}

test('room.music events reach active peers only, never lobby preview subscribers', () => {
  const { connections, runtime } = createHarness();
  const preview = createConnection('preview');
  const active = createConnection('active');
  connections.push(preview, active);

  runtime.broadcastMusicEvent(ROOM_ID, 'room.music.state', {
    roomId: ROOM_ID,
    music: { queue: [{ addedBy: 'peer-1' }] }
  });

  assert.equal(preview.received.length, 0, 'the queue and its authors must not leak into the lobby');
  assert.equal(active.received.length, 1);
  assert.equal(active.received[0].type, 'room.music.state');
});

test('a connection subscribed to preview AND in the call still receives the event once', () => {
  const { connections, runtime } = createHarness();
  const both = createConnection('active');
  both.previewRoomIds.add(ROOM_ID);
  connections.push(both);

  runtime.broadcastMusicEvent(ROOM_ID, 'room.music.position', { roomId: ROOM_ID, positionMs: 1 });
  assert.equal(both.received.length, 1);
});

test('the existing previewOnly and default broadcast modes are unchanged', () => {
  const { connections, runtime } = createHarness();
  const preview = createConnection('preview');
  const active = createConnection('active');
  connections.push(preview, active);

  runtime.broadcastRoomDetail(ROOM_ID, { type: 'legacy' }, { previewOnly: true });
  assert.equal(preview.received.length, 1);
  assert.equal(active.received.length, 0);

  runtime.broadcastRoomDetail(ROOM_ID, { type: 'room.chat.message' });
  assert.equal(preview.received.length, 2);
  assert.equal(active.received.length, 1);
});

test('the preview snapshot carries no music block; the active one does', async () => {
  const musicService = {
    getSnapshotBlock: () => ({
      music: { status: 'playing', queue: [{ addedBy: 'peer-1' }] },
      musicBotIdentity: 'music-bot:room-static'
    })
  };
  const { runtime } = createHarness({ musicService });

  const preview = await runtime.buildRoomSnapshot(ROOM_ID, 'preview');
  assert.equal(preview.mode, 'preview');
  assert.equal('music' in preview, false, 'the lobby preview must not carry the queue');
  assert.equal('musicBotIdentity' in preview, false);

  const active = await runtime.buildRoomSnapshot(ROOM_ID, 'active', { viewerUserId: OWNER_ID });
  assert.equal(active.music.status, 'playing');
  assert.equal(active.musicBotIdentity, 'music-bot:room-static');
  assert.equal(active.musicIsMaster, true);

  const guestView = await runtime.buildRoomSnapshot(ROOM_ID, 'active', { viewerUserId: '' });
  assert.equal(guestView.musicIsMaster, false, 'a guest is never the master');
});

test('a temporary room gets no music block even in the active snapshot', async () => {
  const musicService = { getSnapshotBlock: () => ({ music: {}, musicBotIdentity: 'x' }) };
  const { runtime } = createHarness({ isStatic: false, musicService });
  const active = await runtime.buildRoomSnapshot(ROOM_ID, 'active', { viewerUserId: OWNER_ID });
  assert.equal('music' in active, false);
});

test('music commands carry the permissions cached on the peer at join time', async () => {
  const seen = [];
  const musicService = {
    getSnapshotBlock: () => ({ music: {}, musicBotIdentity: 'x' }),
    handleCommand: async (input) => {
      seen.push(input);
      return { ok: true };
    }
  };
  const peers = new Map([
    ['peer-owner', {
      accountUserId: 'user-7',
      id: 'peer-owner',
      ip: '203.0.113.9',
      isMusicMaster: true,
      isStaticRoom: true,
      transport: { id: 't-1' }
    }]
  ]);
  const { runtime } = createHarness({ musicService, peers });

  const connection = createConnection('active', { peerId: 'peer-owner', transportId: 't-1' });
  const command = normalizeMusicCommand('room.music.stop', {});
  assert.deepEqual(await runtime.handleMusicCommand(connection, command), { ok: true });
  // The account id and the connecting address ride along because the rate
  // limiter keys on them; keying on the client-chosen peerId would let a peer
  // reset its budget by rejoining under a fresh random id.
  assert.deepEqual(seen[0], {
    roomId: ROOM_ID,
    peerId: 'peer-owner',
    accountUserId: 'user-7',
    clientIp: '203.0.113.9',
    isMaster: true,
    isStatic: true,
    command
  });

  // No storage call happens on this path: the fake store would have thrown.
  const lobbyOnly = createConnection('preview');
  assert.deepEqual(
    await runtime.handleMusicCommand(lobbyOnly, command),
    { ok: false, code: 'not_active_peer' },
    'a lobby subscriber is not a peer and may not command the player'
  );

  const staleTransport = createConnection('active', { peerId: 'peer-owner', transportId: 't-old' });
  assert.deepEqual(
    await runtime.handleMusicCommand(staleTransport, command),
    { ok: false, code: 'not_active_peer' }
  );
  assert.equal(seen.length, 1);
});
