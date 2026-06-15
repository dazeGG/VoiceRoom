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
    async createRoom({ creatorIp, isStatic, roomId, now = Date.now() }) {
      const room = {
        createdAt: now,
        creatorIp,
        emptySince: now,
        id: roomId,
        isStatic,
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
