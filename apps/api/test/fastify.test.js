'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApiApp, createApiServer } = require('../src/server');

function createFakeStore() {
  const rooms = new Map();
  return {
    async countQuotaRoomsForIp() {
      return 0;
    },
    async countRooms() {
      return rooms.size;
    },
    async createRoom({ creatorIp, isStatic, roomId, name = '', emoji = '', roomColorKey = 'blue', roomIconKey = 'headphones', roomPresetKey = 'voice-blue', now = Date.now() }) {
      const room = {
        createdAt: now,
        creatorIp,
        emptySince: now,
        id: roomId,
        isStatic,
        emoji,
        name,
        roomColorKey,
        roomIconKey,
        roomPresetKey,
        messages: [],
        peers: new Map(),
        updatedAt: now
      };
      rooms.set(roomId, room);
      return { ...room, peers: new Map() };
    },
    async createRoomWithQuota(options) {
      const room = await this.createRoom(options);
      return { room, status: 'created' };
    },
    async getRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? { ...room, peers: new Map() } : null;
    },
    async getOrCreatePeerIdentity({ peerId, sessionToken }) {
      if (sessionToken && sessionToken.startsWith('bad')) {
        return { identity: null, status: 'token_mismatch' };
      }
      return { identity: { avatarColorKey: 'blurple', peerId }, status: 'created' };
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {}
  };
}

test('createApiApp exposes a Fastify app with inject-based routes', async (t) => {
  const app = createApiApp({ store: createFakeStore() });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/api/healthz' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const created = await app.inject({
    method: 'POST',
    url: '/api/rooms',
    payload: { isStatic: false }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().ok, true);

  const visualRoom = await app.inject({
    method: 'POST',
    url: '/api/rooms',
    payload: { isStatic: false, roomPresetKey: 'game-indigo' }
  });
  assert.equal(visualRoom.statusCode, 201);
  assert.equal(visualRoom.json().emoji, '🎮');
  assert.equal(visualRoom.json().roomIconKey, 'gamepad');
  assert.equal(visualRoom.json().roomColorKey, 'indigo');
  assert.equal(visualRoom.json().roomPresetKey, 'game-indigo');
});

test('createApiServer keeps the legacy http server contract while exposing app/inject', async () => {
  const server = createApiServer({ store: createFakeStore() });
  assert.equal(server.listening, false);
  assert.equal(typeof server.listen, 'function');
  assert.equal(typeof server.inject, 'function');
  assert.equal(typeof server.app.inject, 'function');
  await server.app.ready();
  await server.app.close();
});


test('auth session store failures return 5xx instead of anonymous auth state', async (t) => {
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser() {
        throw new Error('session store unavailable');
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: 'vr_session=test-token' }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'Internal server error');
});

test('logout session store failures return 5xx instead of false success', async (t) => {
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async deleteSession() {
        throw new Error('session delete unavailable');
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: 'vr_session=test-token' }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'Internal server error');
});

test('cookie-authenticated writes reject cross-origin browser requests', async (t) => {
  let deleted = false;
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async deleteSession() {
        deleted = true;
        return true;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: {
      cookie: 'vr_session=test-token',
      host: 'voice.local',
      origin: 'https://evil.local'
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'Cross-origin request rejected');
  assert.equal(deleted, false);

  const sameOrigin = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: {
      cookie: 'vr_session=test-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    }
  });

  assert.equal(sameOrigin.statusCode, 200);
  assert.equal(deleted, true);
});




test('friend request route accepts account user id targets', async (t) => {
  let requestInput = null;
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser(token) {
        assert.equal(token, 'session-token');
        return { user: { id: '11111111-1111-4111-8111-111111111111' } };
      }
    },
    friends: {
      async sendRequest(input) {
        requestInput = input;
        return {
          status: 'sent',
          requestId: 'request-1',
          user: {
            avatarColorKey: 'rose',
            createdAt: Date.now(),
            displayName: 'Bob',
            id: input.addresseeUserId,
            login: 'bob'
          }
        };
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/friends/requests',
    headers: { cookie: 'vr_session=session-token' },
    payload: { userId: '22222222-2222-4222-8222-222222222222' }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().status, 'sent');
  assert.deepEqual(requestInput, {
    requesterId: '11111111-1111-4111-8111-111111111111',
    addresseeLogin: '',
    addresseeUserId: '22222222-2222-4222-8222-222222222222'
  });
});

test('livekit token uses authenticated user avatar color for room peer identity', async (t) => {
  const previous = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET
  };
  process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
  process.env.LIVEKIT_API_KEY = 'devkey';
  process.env.LIVEKIT_API_SECRET = 'devsecretdevsecretdevsecret';

  const store = createFakeStore();
  let identityInput = null;
  store.getOrCreatePeerIdentity = async (input) => {
    identityInput = input;
    return { identity: { avatarColorKey: input.avatarColorKey, peerId: input.peerId }, status: 'created' };
  };

  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token) {
        assert.equal(token, 'session-token');
        return { user: { id: 'user-1', avatarColorKey: 'green' } };
      }
    }
  });
  t.after(async () => {
    await app.close();
    if (previous.url === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = previous.url;
    if (previous.key === undefined) delete process.env.LIVEKIT_API_KEY;
    else process.env.LIVEKIT_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.LIVEKIT_API_SECRET;
    else process.env.LIVEKIT_API_SECRET = previous.secret;
  });

  const room = await app.inject({ method: 'POST', url: '/api/rooms', payload: { isStatic: false } });
  assert.equal(room.statusCode, 201);

  const response = await app.inject({
    method: 'POST',
    url: '/api/livekit-token',
    headers: { cookie: 'vr_session=session-token' },
    payload: {
      name: 'вовощ',
      peerId: 'peer0001',
      roomId: room.json().roomId,
      sessionToken: 'goodtoken123456789012345678901234'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(identityInput.avatarColorKey, 'green');
});

test('livekit token validates persisted anonymous peer identity before issuing voice access', async (t) => {
  const previous = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET
  };
  process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
  process.env.LIVEKIT_API_KEY = 'devkey';
  process.env.LIVEKIT_API_SECRET = 'devsecretdevsecretdevsecret';

  const app = createApiApp({ store: createFakeStore() });
  t.after(async () => {
    await app.close();
    if (previous.url === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = previous.url;
    if (previous.key === undefined) delete process.env.LIVEKIT_API_KEY;
    else process.env.LIVEKIT_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.LIVEKIT_API_SECRET;
    else process.env.LIVEKIT_API_SECRET = previous.secret;
  });

  const room = await app.inject({ method: 'POST', url: '/api/rooms', payload: { isStatic: false } });
  assert.equal(room.statusCode, 201);

  const response = await app.inject({
    method: 'POST',
    url: '/api/livekit-token',
    payload: {
      name: 'Mallory',
      peerId: 'peer0001',
      roomId: room.json().roomId,
      sessionToken: 'badtoken123456789012345678901234'
    }
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.json().error, /недействительна/i);
});
