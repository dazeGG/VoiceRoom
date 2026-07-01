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
const {
  ROOM_PRESETS,
  cleanRoomColorKey,
  cleanRoomEmoji,
  cleanRoomIconKey,
  cleanRoomPresetKey,
  getRoomPreset
} = require('@voice-room/shared/validation');

const OWNER_ID = 'user-owner';
const OWNER_TOKEN = 'session-owner';
const OTHER_TOKEN = 'session-other';
const DEFAULT_ROOM_PRESET = ROOM_PRESETS[0];

function presetFromEmoji(emoji) {
  return ROOM_PRESETS.find((preset) => preset.emoji === emoji) || null;
}

function presetFromVisualKeys(iconKey, colorKey) {
  return ROOM_PRESETS.find((preset) => preset.iconKey === iconKey && preset.colorKey === colorKey) || null;
}

function emojiFromIconKey(iconKey) {
  return ROOM_PRESETS.find((preset) => preset.iconKey === iconKey)?.emoji || DEFAULT_ROOM_PRESET.emoji;
}

function normalizeRoomVisuals({ emoji = '', roomColorKey = '', roomIconKey = '', roomPresetKey = '' } = {}) {
  const legacyEmoji = cleanRoomEmoji(emoji);
  const explicitIconKey = cleanRoomIconKey(roomIconKey);
  const explicitColorKey = cleanRoomColorKey(roomColorKey);
  const preset = getRoomPreset(cleanRoomPresetKey(roomPresetKey));
  const legacyPreset = presetFromEmoji(legacyEmoji);
  const iconKey = explicitIconKey || preset?.iconKey || legacyPreset?.iconKey || DEFAULT_ROOM_PRESET.iconKey;
  const colorKey = explicitColorKey || preset?.colorKey || legacyPreset?.colorKey || DEFAULT_ROOM_PRESET.colorKey;
  const matchedPreset = presetFromVisualKeys(iconKey, colorKey);
  const hasExplicitVisualKey = Boolean(explicitIconKey || explicitColorKey || preset);
  return {
    emoji: matchedPreset?.emoji || (hasExplicitVisualKey ? emojiFromIconKey(iconKey) : legacyEmoji) || DEFAULT_ROOM_PRESET.emoji,
    roomColorKey: colorKey,
    roomIconKey: iconKey,
    roomPresetKey: matchedPreset?.key || ''
  };
}

// In-memory room store covering only the surface the CRUD handlers touch. It
// mirrors the real store's contract: getRoom filters soft-deleted rows, and
// updateRoom/deleteRoom return null / 0-rows once a room is gone.
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
      Object.assign(room, patch, normalizeRoomVisuals(patch), { updatedAt: Date.now() });
      return { ...room, peers: new Map() };
    },
    async deleteRoom(roomId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room || room.deletedAt) return false;
      room.deletedAt = now;
      return true;
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {},
    async listSummaryRecipientUserIds() {
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
    emoji: '🎮',
    isStatic: true,
    name: 'Original',
    ownerId: OWNER_ID,
    roomColorKey: 'indigo',
    roomIconKey: 'gamepad',
    roomPresetKey: 'game-indigo',
    emptySince: null,
    ...overrides
  };
}

function buildApp(seed) {
  const store = createFakeStore(seed);
  const app = createApiApp({ store, users: createFakeUsers() });
  return { app, store };
}

test('PUT /api/rooms/:roomId lets the owner rename and re-skin the room', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Renamed', roomPresetKey: 'voice-blue' }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.room.name, 'Renamed');
  assert.equal(body.room.roomPresetKey, 'voice-blue');
  assert.equal(body.room.roomIconKey, 'headphones');
  assert.equal(body.room.roomColorKey, 'blue');
  assert.equal(body.room.roomId, 'room1');
  // Persisted, not just echoed.
  assert.equal(store.rooms.get('room1').name, 'Renamed');
  assert.equal(store.rooms.get('room1').roomColorKey, 'blue');
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

test('PUT with only a name preserves existing visuals', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Renamed only' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().room.name, 'Renamed only');
  assert.equal(response.json().room.roomPresetKey, 'game-indigo');
  assert.equal(response.json().room.roomIconKey, 'gamepad');
  assert.equal(response.json().room.roomColorKey, 'indigo');
  assert.equal(store.rooms.get('room1').roomColorKey, 'indigo');
});

test('PUT with only a visual field applies it over the existing preset', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { roomColorKey: 'blue' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().room.name, 'Original');
  assert.equal(response.json().room.roomPresetKey, '');
  assert.equal(response.json().room.roomIconKey, 'gamepad');
  assert.equal(response.json().room.roomColorKey, 'blue');
  assert.equal(store.rooms.get('room1').roomColorKey, 'blue');
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

test('PUT rejects an unknown visual key before persisting', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PUT',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` },
    payload: { name: 'Renamed', roomColorKey: 'not-a-real-color' }
  });

  assert.equal(response.statusCode, 400);
  // Nothing written.
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

async function startSocketServer(seed, { store = createFakeStore(seed) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-crud-'));
  const socketPath = path.join(dir, 'api.sock');
  const server = createApiServer({ store, users: createFakeUsers(), friends: createFakeFriends() });
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
    body: { name: 'Live Rename', roomPresetKey: 'voice-blue' }
  });
  assert.equal(updateStatus, 200);

  const updated = await waitForWsType(presence.frames, 'room.updated');
  assert.equal(updated.payload.room.name, 'Live Rename');
  assert.equal(updated.payload.room.roomColorKey, 'blue');
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
    body: { name: 'Chat Rename', roomPresetKey: 'voice-blue' }
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
