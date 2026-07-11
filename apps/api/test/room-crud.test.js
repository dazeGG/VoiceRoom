'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApiApp, createApiServer } = require('../src/server');
const { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType } = require('./ws-harness');

const OWNER_ID = 'user-owner';
const OWNER_TOKEN = 'session-owner';
const OTHER_TOKEN = 'session-other';

// In-memory room store covering only the surface the CRUD handlers touch. It
// mirrors the real store's contract: getRoom filters soft-deleted rows, and
// updateRoom/deleteRoom return null once a room is gone.
function createFakeStore(seed = {}) {
  const rooms = new Map();
  for (const [id, room] of Object.entries(seed)) {
    rooms.set(id, { peers: new Map(), updatedAt: Date.now(), ...room, id });
  }
  return {
    rooms,
    async countRooms() {
      return rooms.size;
    },
    async getRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room || room.deletedAt) return null;
      return { ...room, peers: new Map() };
    },
    async getOrCreatePeerIdentity({ peerId }) {
      return { identity: { avatarColorKey: 'blurple', peerId }, status: 'created' };
    },
    async updateRoom(roomId, patch) {
      const room = rooms.get(roomId);
      if (!room || room.deletedAt) return null;
      Object.assign(room, patch, { updatedAt: Date.now() });
      return { ...room, peers: new Map() };
    },
    async deleteRoom(roomId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room || room.deletedAt) return null;
      room.deletedAt = now;
      return { ...room, peers: new Map() };
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {},
    async listSummaryRecipientUserIds() {
      return [];
    },
    async listVisibleRoomsForUser() {
      return [];
    },
    async listMessages() {
      return [];
    }
  };
}

function createFakeFriends() {
  return {
    async getFriendIds() {
      return [];
    }
  };
}

function createFakeUsers() {
  return {
    async getSessionUser(token) {
      if (token === OWNER_TOKEN) return { user: { id: OWNER_ID } };
      if (token === OTHER_TOKEN) return { user: { id: 'user-other' } };
      return null;
    }
  };
}

function staticRoom(overrides = {}) {
  return {
    createdAt: Date.now(),
    isStatic: true,
    name: 'Original',
    ownerId: OWNER_ID,
    emptySince: null,
    ...overrides
  };
}

function buildApp(seed) {
  const store = createFakeStore(seed);
  const app = createApiApp({ store, users: createFakeUsers() });
  return { app, store };
}

test('PUT /api/rooms/:roomId lets the owner rename the room', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Renamed' }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.room.name, 'Renamed');
  assert.equal(body.room.roomId, 'room1');
  // Persisted, not just echoed.
  assert.equal(store.rooms.get('room1').name, 'Renamed');
});

test('PUT rejects a non-owner with 403', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OTHER_TOKEN}` },
    payload: { name: 'Hijacked' }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(store.rooms.get('room1').name, 'Original');
});

test('PUT without a session returns 401', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    payload: { name: 'Anonymous' }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(store.rooms.get('room1').name, 'Original');
});

test('PUT on a temporary room is forbidden', async (t) => {
  const { app } = buildApp({ room1: staticRoom({ isStatic: false }) });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Renamed' }
  });

  assert.equal(response.statusCode, 403);
});

test('PUT on a soft-deleted room returns 404', async (t) => {
  const { app } = buildApp({ room1: staticRoom({ deletedAt: Date.now() }) });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Ghost' }
  });

  assert.equal(response.statusCode, 404);
});

test('PUT rejects an empty name for static rooms', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: '   ' }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'Дайте комнате название');
  assert.equal(store.rooms.get('room1').name, 'Original');
});

test('DELETE soft-deletes the room for the owner', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.ok(store.rooms.get('room1').deletedAt);

  // Subsequent GET is a not-found.
  const status = await app.inject({ method: 'GET', url: '/api/rooms/room1' });
  assert.equal(status.json().ok, false);
});

test('DELETE rejects a non-owner with 403', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OTHER_TOKEN}` }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(store.rooms.get('room1').deletedAt, undefined);
});

test('DELETE without a session returns 401', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/api/rooms/room1' });

  assert.equal(response.statusCode, 401);
  assert.equal(store.rooms.get('room1').deletedAt, undefined);
});

test('cookie-authenticated PUT/DELETE reject cross-origin browser requests (CSRF guard)', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const put = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}`, host: 'voice.local', origin: 'https://evil.local' },
    payload: { name: 'Hijacked' }
  });
  assert.equal(put.statusCode, 403);
  assert.equal(put.json().error, 'Cross-origin request rejected');
  assert.equal(store.rooms.get('room1').name, 'Original');

  const del = await app.inject({
    method: 'DELETE',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}`, host: 'voice.local', origin: 'https://evil.local' }
  });
  assert.equal(del.statusCode, 403);
  assert.equal(store.rooms.get('room1').deletedAt, undefined);
});

const OWNER_PEER_TOKEN = 'peertoken12345678901234567890123456';
const GUEST_PEER_TOKEN = 'guesttoken12345678901234567890123456';

async function openVoiceSession(socketPath, { cookie = '', roomId, peerId, sessionToken, name }) {
  const session = openWs(socketPath, { cookie });
  await session.ready;
  await joinVoiceRoom(session, { roomId, peerId, sessionToken, name });
  return session;
}

async function openPreviewSession(socketPath, roomId, { cookie = '' } = {}) {
  const session = openWs(socketPath, { cookie });
  await session.ready;
  await subscribeRoomPreview(session, roomId);
  return session;
}

async function startSocketServer(seed, { store = createFakeStore(seed), users = createFakeUsers() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-crud-'));
  const socketPath = path.join(dir, 'api.sock');
  const server = createApiServer({ store, users, friends: createFakeFriends() });
  await new Promise((resolve, reject) => {
    server.listen({ path: socketPath }, (error) => (error ? reject(error) : resolve()));
  });
  return { dir, socketPath, store, server };
}

async function requestOnSocket(socketPath, { method, path: reqPath, body, cookie }) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method,
        path: reqPath,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {}),
          ...(cookie ? { cookie } : {})
        }
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function teardownSocketServer(t, { server, dir, sessions = [] }) {
  t.after(async () => {
    for (const session of sessions) {
      session.ws?.close();
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
}


test('authenticated room presence exposes only minimal account user id on peers', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const ownerPresence = await openVoiceSession(socketPath, {
    cookie: `vr_session=${OWNER_TOKEN}`,
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Owner'
  });
  const guestPresence = await openVoiceSession(socketPath, {
    roomId: 'room1',
    peerId: 'peer0002',
    sessionToken: GUEST_PEER_TOKEN,
    name: 'Guest'
  });
  teardownSocketServer(t, { server, dir, sessions: [ownerPresence, guestPresence] });

  const ownerPeer = ownerPresence.frames
    .find((frame) => frame.type === 'room.snapshot')
    ?.payload?.peers?.find((peer) => peer.id === 'peer0001');
  assert.equal(ownerPeer.accountUserId, OWNER_ID);
  assert.equal('login' in ownerPeer, false);

  const guestSnapshot = guestPresence.frames.find((frame) => frame.type === 'room.snapshot')?.payload;
  const guestSelf = guestSnapshot?.peers?.find((peer) => peer.id === 'peer0002');
  assert.equal(guestSelf.accountUserId, '');
  const ownerAsPeer = guestSnapshot?.peers?.find((peer) => peer.id === 'peer0001');
  assert.equal(ownerAsPeer.accountUserId, OWNER_ID);
  assert.equal('login' in ownerAsPeer, false);
});

test('room join refreshes avatar identity changed after the websocket opened', async (t) => {
  const owner = {
    id: OWNER_ID,
    avatarAccent: null,
    avatarColorKey: 'blurple',
    avatarKey: null
  };
  const users = {
    async getSessionUser(token) {
      return token === OWNER_TOKEN ? { user: { ...owner } } : null;
    }
  };
  const { dir, socketPath, server } = await startSocketServer(
    { room1: staticRoom() },
    { users }
  );
  const presence = openWs(socketPath, { cookie: `vr_session=${OWNER_TOKEN}` });
  await presence.ready;

  owner.avatarAccent = '#49303f';
  owner.avatarKey = 'av_user-owner_deadbeef.webp';
  await joinVoiceRoom(presence, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Owner'
  });
  teardownSocketServer(t, { server, dir, sessions: [presence] });

  const peer = presence.frames
    .find((frame) => frame.type === 'room.snapshot')
    ?.payload?.peers?.find((entry) => entry.id === 'peer0001');
  assert.equal(peer.avatarAccent, '#49303f');
  assert.equal(peer.avatarColorKey, 'blurple');
  assert.equal(peer.avatarUrl, '/api/avatars/av_user-owner_deadbeef.webp');
});

test('an active peer receives room.updated over the voice stream', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const presence = await openVoiceSession(socketPath, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Tester'
  });
  teardownSocketServer(t, { server, dir, sessions: [presence] });

  const updateStatus = await requestOnSocket(socketPath, {
    method: 'PUT',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`,
    body: { name: 'Live Rename' }
  });
  assert.equal(updateStatus, 200);

  const updated = await waitForWsType(presence.frames, 'room.updated');
  assert.equal(updated.payload.room.name, 'Live Rename');
  assert.equal('emoji' in updated.payload.room, false);
  assert.equal(updated.payload.room.roomId, 'room1');
});

test('an active peer receives room.deleted over the voice stream', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const presence = await openVoiceSession(socketPath, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Tester'
  });
  teardownSocketServer(t, { server, dir, sessions: [presence] });

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 200);

  const deleted = await waitForWsType(presence.frames, 'room.deleted');
  assert.equal(deleted.payload.roomId, 'room1');
});

test('a preview subscriber receives room.updated and room.deleted lifecycle frames', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const preview = await openPreviewSession(socketPath, 'room1');
  teardownSocketServer(t, { server, dir, sessions: [preview] });

  const updateStatus = await requestOnSocket(socketPath, {
    method: 'PUT',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`,
    body: { name: 'Chat Rename' }
  });
  assert.equal(updateStatus, 200);

  const updated = await waitForWsType(preview.frames, 'room.updated');
  assert.equal(updated.payload.room.name, 'Chat Rename');
  assert.equal(updated.payload.room.roomId, 'room1');

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 200);

  const deleted = await waitForWsType(preview.frames, 'room.deleted');
  assert.equal(deleted.payload.roomId, 'room1');
});

test('DELETE does not broadcast lifecycle frames when persistence fails', async (t) => {
  const store = createFakeStore({ room1: staticRoom() });
  store.deleteRoom = async () => false;
  const { dir, socketPath, server } = await startSocketServer(null, { store });
  const preview = await openPreviewSession(socketPath, 'room1');
  teardownSocketServer(t, { server, dir, sessions: [preview] });

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 404);
  await assert.rejects(waitForWsType(preview.frames, 'room.deleted', () => true, 150), /room.deleted/);
});
