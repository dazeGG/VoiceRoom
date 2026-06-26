'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApiApp, createApiServer } = require('../src/server');
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
    async pruneRooms() {}
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

function openSseStream(socketPath, pathname, { readyType = 'hello', timeoutMs = 5000 } = {}) {
  const frames = [];
  let buffer = '';
  let streamTimer = null;
  let req = null;
  let closed = false;
  let resolveClosed = null;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const markClosed = () => {
    closed = true;
    resolveClosed?.();
  };

  const ready = new Promise((resolve, reject) => {
    const resolveOnce = () => {
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = null;
      resolve();
    };
    if (readyType) {
      streamTimer = setTimeout(() => reject(new Error(`SSE stream did not deliver ${readyType}`)), timeoutMs);
    }
    req = http.get({ socketPath, path: pathname }, (res) => {
      if (!readyType) resolveOnce();
      res.setEncoding('utf8');
      res.on('end', markClosed);
      res.on('close', markClosed);
      res.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine.slice(5).trim());
          frames.push(parsed);
          if (readyType && parsed.type === readyType) resolveOnce();
        }
      });
    });
    req.on('error', (error) => {
      markClosed();
      reject(error);
    });
  });

  return {
    frames,
    req,
    ready,
    clearTimer() {
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = null;
    },
    waitUntilClosed(timeoutMs = 1000) {
      if (closed) return Promise.resolve();
      return Promise.race([
        closedPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('SSE stream did not close')), timeoutMs))
      ]);
    },
    waitFor(type, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          const found = frames.find((frame) => frame.type === type);
          if (found) return resolve(found);
          if (Date.now() > deadline) return reject(new Error(`${type} frame not received`));
          setTimeout(poll, 25);
        };
        poll();
      });
    }
  };
}

async function startSocketServer(seed, { store = createFakeStore(seed) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-crud-'));
  const socketPath = path.join(dir, 'api.sock');
  const server = createApiServer({ store, users: createFakeUsers() });
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

function teardownSocketServer(t, { server, dir, streams = [] }) {
  t.after(async () => {
    for (const stream of streams) {
      stream.clearTimer?.();
      stream.req?.destroy();
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// End-to-end over a real socket so an active peer holds a live /api/events SSE
// stream and observes the room-updated frame broadcast by the PUT handler.
test('an active peer receives room-updated over the presence stream', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const peerToken = 'peertoken12345678901234567890123456';
  const presence = openSseStream(
    socketPath,
    `/api/events?room=room1&peer=peer0001&token=${peerToken}&name=Tester`
  );
  teardownSocketServer(t, { server, dir, streams: [presence] });

  await presence.ready;

  const updateStatus = await requestOnSocket(socketPath, {
    method: 'PUT',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`,
    body: { name: 'Live Rename', roomPresetKey: 'voice-blue' }
  });
  assert.equal(updateStatus, 200);

  const updated = await presence.waitFor('room-updated');
  assert.equal(updated.room.name, 'Live Rename');
  assert.equal(updated.room.roomColorKey, 'blue');
  assert.equal(updated.room.roomId, 'room1');
});

test('an active peer receives room-deleted over the presence stream', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const peerToken = 'peertoken12345678901234567890123456';
  const presence = openSseStream(
    socketPath,
    `/api/events?room=room1&peer=peer0001&token=${peerToken}&name=Tester`
  );
  teardownSocketServer(t, { server, dir, streams: [presence] });

  await presence.ready;

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 200);

  const deleted = await presence.waitFor('room-deleted');
  assert.equal(deleted.roomId, 'room1');
});

test('a chat-stream subscriber receives room-updated and room-deleted lifecycle frames', async (t) => {
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() });
  const chat = openSseStream(socketPath, '/api/rooms/room1/chat/stream', { readyType: null });
  teardownSocketServer(t, { server, dir, streams: [chat] });

  await chat.ready;

  const updateStatus = await requestOnSocket(socketPath, {
    method: 'PUT',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`,
    body: { name: 'Chat Rename', roomPresetKey: 'voice-blue' }
  });
  assert.equal(updateStatus, 200);

  const updated = await chat.waitFor('room-updated');
  assert.equal(updated.room.name, 'Chat Rename');
  assert.equal(updated.room.roomId, 'room1');

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 200);

  const deleted = await chat.waitFor('room-deleted');
  assert.equal(deleted.roomId, 'room1');
  await chat.waitUntilClosed();
});

test('DELETE does not broadcast lifecycle frames when persistence fails', async (t) => {
  const store = createFakeStore({ room1: staticRoom() });
  store.deleteRoom = async () => false;
  const { dir, socketPath, server } = await startSocketServer(null, { store });
  const chat = openSseStream(socketPath, '/api/rooms/room1/chat/stream', { readyType: null });
  teardownSocketServer(t, { server, dir, streams: [chat] });

  await chat.ready;

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 404);
  await assert.rejects(chat.waitFor('room-deleted', 150), /room-deleted frame not received/);
});
