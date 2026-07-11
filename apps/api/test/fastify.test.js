'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApiApp, createApiServer } = require('../src/server');
const { resetMetricsForTest } = require('../src/lib/metrics');

function createFakeStore() {
  const rooms = new Map();
  return {
    async countQuotaRoomsForIp() {
      return 0;
    },
    async countRooms() {
      return rooms.size;
    },
    async createRoom({ creatorIp, isStatic, roomId, name = '', now = Date.now() }) {
      const room = {
        createdAt: now,
        creatorIp,
        emptySince: now,
        id: roomId,
        isStatic,
        name,
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
    async pruneRooms() {},
    async listSummaryRecipientUserIds() {
      return [];
    }
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

  const legacyVisualRoom = await app.inject({
    method: 'POST',
    url: '/api/rooms',
    payload: { isStatic: false, roomPresetKey: 'game-indigo', emoji: '🎮' }
  });
  assert.equal(legacyVisualRoom.statusCode, 201);
  assert.equal('emoji' in legacyVisualRoom.json(), false);
  assert.equal('roomPresetKey' in legacyVisualRoom.json(), false);
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

test('push subscription routes require auth and validate subscription payloads', async (t) => {
  const writes = [];
  const removals = [];
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser(token) {
        return token === 'push-session' ? { user: { id: 'user-1' } } : null;
      }
    },
    pushes: {
      async upsert(input) { writes.push(input); return { id: 'subscription-1' }; },
      async remove(input) { removals.push(input); return true; }
    },
    push: { config: { enabled: true, vapidPublicKey: 'public-key' }, async sendToUser() {} }
  });
  t.after(() => app.close());

  const config = await app.inject({ method: 'GET', url: '/api/push/config' });
  assert.deepEqual(config.json(), { enabled: true, vapidPublicKey: 'public-key' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/push/subscriptions', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: { cookie: 'vr_session=push-session' },
    payload: { subscription: { endpoint: 'javascript:alert(1)', keys: { p256dh: 'key', auth: 'auth' } } }
  })).statusCode, 400);

  const created = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: { cookie: 'vr_session=push-session', 'user-agent': 'test-browser' },
    payload: { subscription: { endpoint: 'https://push.example/device', keys: { p256dh: 'key', auth: 'auth' } } }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(writes[0].userId, 'user-1');
  assert.equal(writes[0].metadata.userAgent, 'test-browser');

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/push/subscriptions',
    headers: { cookie: 'vr_session=push-session' },
    payload: { endpoint: 'https://push.example/device' }
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removals[0], { userId: 'user-1', endpoint: 'https://push.example/device' });
});

test('api metrics expose prometheus counters and runtime gauges', async (t) => {
  resetMetricsForTest();
  const app = createApiApp({ store: createFakeStore() });
  t.after(() => app.close());

  const health = await app.inject({ method: 'GET', url: '/api/healthz' });
  assert.equal(health.statusCode, 200);

  const metrics = await app.inject({ method: 'GET', url: '/api/metrics' });
  assert.equal(metrics.statusCode, 200);
  assert.match(metrics.headers['content-type'], /text\/plain/);
  assert.match(metrics.body, /# TYPE voice_room_api_http_requests_total counter/);
  assert.ok(metrics.body.includes('voice_room_api_http_requests_total{method="GET",route="/api/healthz",status="200"} 1'));
  assert.match(metrics.body, /voice_room_api_ws_connections 0/);
  assert.match(metrics.body, /voice_room_api_ws_guest_connections 0/);
  assert.match(metrics.body, /voice_room_api_presence_rooms 0/);
  assert.match(metrics.body, /voice_room_api_pg_pool_errors_total 0/);
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

test('moderation routes require the owner of a static room', async (t) => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const users = {
    async getSessionUser() {
      return { user: { id: userId } };
    }
  };
  const baseStore = createFakeStore();
  const request = (url) => ({
    method: 'POST',
    url,
    headers: { cookie: 'vr_session=session-token', host: 'voice.local', origin: 'http://voice.local' },
    payload: { peerId: 'peer-12345678' }
  });

  const nonOwnerApp = createApiApp({
    users,
    store: { ...baseStore, async getRoom() { return { id: 'room-1', isStatic: true, ownerId: 'other-user', peers: new Map() }; } }
  });
  t.after(() => nonOwnerApp.close());
  assert.equal((await nonOwnerApp.inject(request('/api/rooms/room-1/kick'))).statusCode, 403);

  const temporaryApp = createApiApp({
    users,
    store: { ...baseStore, async getRoom() { return { id: 'room-2', isStatic: false, ownerId: userId, peers: new Map() }; } }
  });
  t.after(() => temporaryApp.close());
  assert.equal((await temporaryApp.inject(request('/api/rooms/room-2/ban'))).statusCode, 403);
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
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
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

test('notification preference routes require auth and expose defaults', async (t) => {
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser(token) {
        assert.equal(token, 'session-token');
        return { user: { id: '11111111-1111-4111-8111-111111111111' } };
      }
    },
    notifications: {
      async getPreferences(userId) {
        assert.equal(userId, '11111111-1111-4111-8111-111111111111');
        return { mutedPeerIds: [], mutedRoomIds: [], privateNotifications: false };
      }
    }
  });
  t.after(() => app.close());

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });
  assert.equal(unauthenticated.statusCode, 401);

  const response = await app.inject({
    method: 'GET',
    url: '/api/notifications/preferences',
    headers: { cookie: 'vr_session=session-token' }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().preferences, {
    mutedPeerIds: [],
    mutedRoomIds: [],
    privateNotifications: false
  });
});

test('notification mute and privacy routes call notification store and map statuses', async (t) => {
  const calls = [];
  const preferences = {
    mutedPeerIds: ['22222222-2222-4222-8222-222222222222'],
    mutedRoomIds: ['room-1'],
    privateNotifications: true
  };
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser() {
        return { user: { id: '11111111-1111-4111-8111-111111111111' } };
      }
    },
    notifications: {
      async setDmMute(input) {
        calls.push(['dm', input]);
        if (input.peerUserId === '33333333-3333-4333-8333-333333333333') {
          return { status: 'not_friends', preferences: { ...preferences, mutedPeerIds: [] } };
        }
        return { status: input.muted ? 'muted' : 'unmuted', preferences };
      },
      async setRoomMute(input) {
        calls.push(['room', input]);
        if (input.roomId === 'missing-room') return { status: 'not_found', preferences };
        return { status: input.muted ? 'muted' : 'unmuted', preferences };
      },
      async setPrivateNotifications(input) {
        calls.push(['privacy', input]);
        return { status: 'updated', preferences };
      }
    }
  });
  t.after(() => app.close());

  const dm = await app.inject({
    method: 'PUT',
    url: '/api/notifications/dm/22222222-2222-4222-8222-222222222222/mute',
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { muted: true }
  });
  assert.equal(dm.statusCode, 200);
  assert.equal(dm.json().muted, true);
  assert.deepEqual(calls[0], ['dm', {
    userId: '11111111-1111-4111-8111-111111111111',
    peerUserId: '22222222-2222-4222-8222-222222222222',
    muted: true
  }]);

  const notFriends = await app.inject({
    method: 'PUT',
    url: '/api/notifications/dm/33333333-3333-4333-8333-333333333333/mute',
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { muted: true }
  });
  assert.equal(notFriends.statusCode, 403);

  const room = await app.inject({
    method: 'PUT',
    url: '/api/notifications/rooms/room-1/mute',
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { muted: false }
  });
  assert.equal(room.statusCode, 200);
  assert.equal(room.json().muted, false);
  assert.deepEqual(calls[2], ['room', {
    userId: '11111111-1111-4111-8111-111111111111',
    roomId: 'room-1',
    muted: false
  }]);

  const privacy = await app.inject({
    method: 'PUT',
    url: '/api/notifications/privacy',
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { privateNotifications: true }
  });
  assert.equal(privacy.statusCode, 200);
  assert.equal(privacy.json().preferences.privateNotifications, true);
  assert.deepEqual(calls[3], ['privacy', {
    userId: '11111111-1111-4111-8111-111111111111',
    privateNotifications: true
  }]);
});


test('notification mutation routes reject invalid booleans and targets before store calls', async (t) => {
  const calls = [];
  const currentUserId = '11111111-1111-4111-8111-111111111111';
  const headers = {
    cookie: 'vr_session=session-token',
    host: 'voice.local',
    origin: 'http://voice.local'
  };
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser() {
        return { user: { id: currentUserId } };
      }
    },
    notifications: {
      async setDmMute(input) {
        calls.push(['dm', input]);
        return { status: 'muted', preferences: { mutedPeerIds: [], mutedRoomIds: [], privateNotifications: false } };
      },
      async setRoomMute(input) {
        calls.push(['room', input]);
        return { status: 'muted', preferences: { mutedPeerIds: [], mutedRoomIds: [], privateNotifications: false } };
      },
      async setPrivateNotifications(input) {
        calls.push(['privacy', input]);
        return { status: 'updated', preferences: { mutedPeerIds: [], mutedRoomIds: [], privateNotifications: false } };
      }
    }
  });
  t.after(() => app.close());

  const invalidDmPayloads = [
    {},
    { muted: 'true' },
    { muted: 1 }
  ];
  for (const payload of invalidDmPayloads) {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/notifications/dm/22222222-2222-4222-8222-222222222222/mute',
      headers,
      payload
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { ok: false, error: 'muted must be a boolean' });
  }

  const dmSelf = await app.inject({
    method: 'PUT',
    url: `/api/notifications/dm/${currentUserId}/mute`,
    headers,
    payload: { muted: true }
  });
  assert.equal(dmSelf.statusCode, 400);
  assert.equal(dmSelf.json().ok, false);

  const invalidPeer = await app.inject({
    method: 'PUT',
    url: '/api/notifications/dm/not-a-user-id/mute',
    headers,
    payload: { muted: true }
  });
  assert.equal(invalidPeer.statusCode, 404);
  assert.equal(invalidPeer.json().ok, false);

  const invalidRoomPayload = await app.inject({
    method: 'PUT',
    url: '/api/notifications/rooms/room-1/mute',
    headers,
    payload: { muted: 'false' }
  });
  assert.equal(invalidRoomPayload.statusCode, 400);
  assert.deepEqual(invalidRoomPayload.json(), { ok: false, error: 'muted must be a boolean' });

  const invalidRoom = await app.inject({
    method: 'PUT',
    url: '/api/notifications/rooms/%20/mute',
    headers,
    payload: { muted: true }
  });
  assert.equal(invalidRoom.statusCode, 404);
  assert.equal(invalidRoom.json().ok, false);

  const invalidPrivacy = await app.inject({
    method: 'PUT',
    url: '/api/notifications/privacy',
    headers,
    payload: {}
  });
  assert.equal(invalidPrivacy.statusCode, 400);
  assert.deepEqual(invalidPrivacy.json(), { ok: false, error: 'privateNotifications must be a boolean' });

  assert.deepEqual(calls, []);
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
