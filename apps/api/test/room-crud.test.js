'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApiApp, createApiServer } = require('../src/server');

const OWNER_ID = 'user-owner';
const OWNER_TOKEN = 'session-owner';
const OTHER_TOKEN = 'session-other';

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
      Object.assign(room, patch, { updatedAt: Date.now() });
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

// End-to-end over a real socket so an active peer holds a live /api/events SSE
// stream and observes the room-updated frame broadcast by the PUT handler.
test('an active peer receives room-updated over the presence stream', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-crud-'));
  const socketPath = path.join(dir, 'api.sock');

  const store = createFakeStore({ room1: staticRoom() });
  const server = createApiServer({ store, users: createFakeUsers() });
  await new Promise((resolve, reject) => {
    server.listen({ path: socketPath }, (error) => (error ? reject(error) : resolve()));
  });

  const peerToken = 'peertoken12345678901234567890123456';
  const frames = [];
  let buffer = '';
  let streamTimer = null;
  let eventsReq = null;

  // Teardown is explicit (not via t.after LIFO ordering): drop the live SSE
  // socket first, then force-close any lingering keep-alive connections so
  // server.close resolves instead of waiting on the open stream forever.
  t.after(async () => {
    if (streamTimer) clearTimeout(streamTimer);
    eventsReq?.destroy();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const streamReady = new Promise((resolve, reject) => {
    streamTimer = setTimeout(() => reject(new Error('SSE stream did not deliver hello')), 5000);
    const resolveOnce = () => {
      clearTimeout(streamTimer);
      streamTimer = null;
      resolve();
    };
    eventsReq = http.get(
      { socketPath, path: `/api/events?room=room1&peer=peer0001&token=${peerToken}&name=Tester` },
      (res) => {
        res.setEncoding('utf8');
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
            if (parsed.type === 'hello') resolveOnce();
          }
        });
      }
    );
    eventsReq.on('error', () => {});
  });

  await streamReady;

  const updateBody = JSON.stringify({ name: 'Live Rename', roomPresetKey: 'voice-blue' });
  const updateStatus = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method: 'PUT',
        path: '/api/rooms/room1',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(updateBody),
          cookie: `vr_session=${OWNER_TOKEN}`
        }
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.write(updateBody);
    req.end();
  });
  assert.equal(updateStatus, 200);

  // Wait for the room-updated frame to land on the peer's stream.
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (frames.some((frame) => frame.type === 'room-updated')) return resolve();
      if (Date.now() > deadline) return reject(new Error('room-updated frame not received'));
      setTimeout(poll, 25);
    };
    poll();
  });

  const updated = frames.find((frame) => frame.type === 'room-updated');
  assert.equal(updated.room.name, 'Live Rename');
  assert.equal(updated.room.roomColorKey, 'blue');
  assert.equal(updated.room.roomId, 'room1');
});
