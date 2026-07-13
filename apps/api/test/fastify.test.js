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
        if (token === 'push-session') return { user: { id: 'user-1' } };
        if (token === 'push-rate-session') return { user: { id: 'user-rate-limit' } };
        return null;
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
    payload: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { p256dh: 'key', auth: 'auth' } } }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(writes[0].userId, 'user-1');
  assert.equal(writes[0].metadata.userAgent, 'test-browser');

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/push/subscriptions',
    headers: { cookie: 'vr_session=push-session' },
    payload: { endpoint: 'https://fcm.googleapis.com/fcm/send/device' }
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removals[0], { userId: 'user-1', endpoint: 'https://fcm.googleapis.com/fcm/send/device' });

  for (const endpoint of ['https://127.0.0.1/private', 'https://fcm.googleapis.com.evil.example/device']) {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { cookie: 'vr_session=push-session' },
      payload: { subscription: { endpoint, keys: { p256dh: 'key', auth: 'auth' } } }
    });
    assert.equal(rejected.statusCode, 400);
  }

  let limited;
  for (let index = 0; index < 21; index += 1) {
    limited = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { cookie: 'vr_session=push-rate-session' },
      payload: {
        subscription: {
          endpoint: `https://fcm.googleapis.com/fcm/send/rate-${index}`,
          keys: { p256dh: 'key', auth: 'auth' }
        }
      }
    });
  }
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
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

test('message edit routes reuse send validation and never grant room owners an author override', async (t) => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const authorId = '22222222-2222-4222-8222-222222222222';
  const peerId = '33333333-3333-4333-8333-333333333333';
  const roomId = 'room-edit1';
  let roomEdit = null;
  let dmEdit = null;
  let bannedUserId = null;
  const store = {
    ...createFakeStore(),
    async findActiveRoomBan({ userId }) {
      return userId === bannedUserId ? { id: 'ban-1' } : null;
    },
    async getRoom() {
      return { id: roomId, isStatic: true, ownerId, peers: new Map() };
    },
    async getMessage() {
      return {
        authorUserId: authorId,
        avatarColorKey: 'blurple',
        createdAt: 100,
        editedAt: null,
        expiresAt: 10_000,
        id: 'room-message-1',
        name: 'Author',
        peerId: `auth-${authorId}`,
        roomId,
        text: 'before'
      };
    },
    async editMessage(nextRoomId, messageId, text) {
      roomEdit = { roomId: nextRoomId, messageId, text };
      return { ...(await this.getMessage()), text, editedAt: 200 };
    }
  };
  const friends = {
    async getMessage() {
      return { id: 'dm-message-1', senderId: authorId, recipientId: peerId, body: 'before' };
    },
    async editMessage(input) {
      dmEdit = input;
      return { id: input.messageId, senderId: input.senderId, recipientId: input.recipientId, body: input.body, createdAt: 100, editedAt: 200, readAt: null };
    }
  };
  const app = createApiApp({
    store,
    friends,
    users: {
      async getSessionUser(token) {
        if (token === 'owner-session') return { user: { id: ownerId } };
        if (token === 'author-session') return { user: { id: authorId } };
        return null;
      }
    }
  });
  t.after(() => app.close());

  const request = (url, cookie, payload = { text: ' updated \n\n\n line ' }) => app.inject({
    method: 'PATCH',
    url,
    headers: { cookie: `vr_session=${cookie}`, host: 'voice.local', origin: 'http://voice.local' },
    payload
  });

  const ownerRoomEdit = await request(`/api/rooms/${roomId}/chat/room-message-1`, 'owner-session');
  assert.equal(ownerRoomEdit.statusCode, 403);
  assert.equal(roomEdit, null);

  const authorRoomEdit = await request(
    `/api/rooms/${roomId}/chat/room-message-1`,
    'author-session',
    { peerId: `auth-${authorId}`, text: ' updated \n\n\n line ' }
  );
  assert.equal(authorRoomEdit.statusCode, 200);
  assert.deepEqual(roomEdit, { roomId, messageId: 'room-message-1', text: 'updated\n\nline' });
  assert.equal(authorRoomEdit.json().message.editedAt, 200);
  assert.equal(authorRoomEdit.json().message.authorUserId, authorId);

  bannedUserId = authorId;
  roomEdit = null;
  const bannedRoomEdit = await request(`/api/rooms/${roomId}/chat/room-message-1`, 'author-session');
  assert.equal(bannedRoomEdit.statusCode, 403);
  assert.equal(bannedRoomEdit.json().code, 'room_banned');
  assert.equal(roomEdit, null);
  bannedUserId = null;

  const forbiddenDmEdit = await request(`/api/dm/${peerId}/messages/dm-message-1`, 'owner-session');
  assert.equal(forbiddenDmEdit.statusCode, 403);
  assert.equal(dmEdit, null);

  const authorDmEdit = await request(`/api/dm/${peerId}/messages/dm-message-1`, 'author-session');
  assert.equal(authorDmEdit.statusCode, 200);
  assert.deepEqual(dmEdit, {
    messageId: 'dm-message-1',
    senderId: authorId,
    recipientId: peerId,
    body: 'updated\n\nline'
  });
  assert.equal(authorDmEdit.json().message.editedAt, 200);
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
        return { doNotDisturb: false, mutedPeerIds: [], presenceStatus: 'online', privateNotifications: false };
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
    doNotDisturb: false,
    mutedPeerIds: [],
    presenceStatus: 'online',
    privateNotifications: false
  });
});

test('notification mute and privacy routes call notification store and map statuses', async (t) => {
  const calls = [];
  const preferences = {
    doNotDisturb: true,
    mutedPeerIds: ['22222222-2222-4222-8222-222222222222'],
    presenceStatus: 'dnd',
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
      async setPrivateNotifications(input) {
        calls.push(['privacy', input]);
        return { status: 'updated', preferences };
      },
      async setDoNotDisturb(input) {
        calls.push(['dnd', input]);
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
  assert.deepEqual(calls[2], ['privacy', {
    userId: '11111111-1111-4111-8111-111111111111',
    privateNotifications: true
  }]);

  const dnd = await app.inject({
    method: 'POST',
    url: '/api/notifications/settings',
    headers: {
      cookie: 'vr_session=session-token',
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { dnd: true }
  });
  assert.equal(dnd.statusCode, 200);
  assert.equal(dnd.json().preferences.doNotDisturb, true);
  assert.deepEqual(calls[3], ['dnd', {
    userId: '11111111-1111-4111-8111-111111111111',
    doNotDisturb: true
  }]);
});

test('presence status route requires auth, validates canonical values, and syncs DND', async (t) => {
  const calls = [];
  const currentUserId = '11111111-1111-4111-8111-111111111111';
  const app = createApiApp({
    store: createFakeStore(),
    users: {
      async getSessionUser(token) {
        if (token !== 'session-token') return null;
        return {
          user: {
            id: currentUserId,
            login: 'alice',
            presenceStatus: 'online',
            doNotDisturb: false
          }
        };
      }
    },
    friends: {
      async getFriendIds(userId) {
        assert.equal(userId, currentUserId);
        return [];
      }
    },
    notifications: {
      async setPresenceStatus(input) {
        calls.push(input);
        return {
          status: 'updated',
          preferences: {
            doNotDisturb: input.presenceStatus === 'dnd',
            mutedPeerIds: [],
            presenceStatus: input.presenceStatus,
            presenceStatusAutomatic: Boolean(input.automatic && input.presenceStatus === 'away'),
            privateNotifications: false
          }
        };
      }
    }
  });
  t.after(() => app.close());

  const unauthenticated = await app.inject({
    method: 'POST',
    url: '/api/presence/status',
    payload: { status: 'away' }
  });
  assert.equal(unauthenticated.statusCode, 401);

  const headers = {
    cookie: 'vr_session=session-token',
    host: 'voice.local',
    origin: 'http://voice.local'
  };
  for (const status of ['online', 'away', 'dnd', 'offline']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/presence/status',
      headers,
      payload: { status }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().preferences.presenceStatus, status);
    assert.equal(response.json().preferences.doNotDisturb, status === 'dnd');
  }
  assert.deepEqual(calls, ['online', 'away', 'dnd', 'offline'].map((presenceStatus) => ({
    automatic: false,
    userId: currentUserId,
    presenceStatus
  })));

  const automaticAway = await app.inject({
    method: 'POST',
    url: '/api/presence/status',
    headers,
    payload: { status: 'away', automatic: true }
  });
  assert.equal(automaticAway.statusCode, 200);
  assert.equal(automaticAway.json().preferences.presenceStatus, 'away');
  assert.equal(automaticAway.json().preferences.presenceStatusAutomatic, true);
  assert.deepEqual(calls.at(-1), {
    automatic: true,
    userId: currentUserId,
    presenceStatus: 'away'
  });

  for (const [payload, error] of [
    [{}, 'status must be one of: online, away, dnd, offline'],
    [{ status: 'busy' }, 'status must be one of: online, away, dnd, offline'],
    [{ status: ' online ' }, 'status must be one of: online, away, dnd, offline'],
    [{ status: null }, 'status must be one of: online, away, dnd, offline'],
    [{ status: 'away', automatic: 'yes' }, 'automatic must be a boolean'],
    [{ status: 'dnd', automatic: true }, 'automatic presence can only transition between online and away']
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/presence/status',
      headers,
      payload
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { ok: false, error });
  }
  assert.equal(calls.length, 5);
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
        return { status: 'muted', preferences: { mutedPeerIds: [], privateNotifications: false } };
      },
      async setPrivateNotifications(input) {
        calls.push(['privacy', input]);
        return { status: 'updated', preferences: { mutedPeerIds: [], privateNotifications: false } };
      },
      async setDoNotDisturb(input) {
        calls.push(['dnd', input]);
        return { status: 'updated', preferences: { doNotDisturb: false, mutedPeerIds: [], presenceStatus: 'online', privateNotifications: false } };
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

  const invalidPrivacy = await app.inject({
    method: 'PUT',
    url: '/api/notifications/privacy',
    headers,
    payload: {}
  });
  assert.equal(invalidPrivacy.statusCode, 400);
  assert.deepEqual(invalidPrivacy.json(), { ok: false, error: 'privateNotifications must be a boolean' });

  const invalidDnd = await app.inject({
    method: 'POST',
    url: '/api/notifications/settings',
    headers,
    payload: { dnd: 'true' }
  });
  assert.equal(invalidDnd.statusCode, 400);
  assert.deepEqual(invalidDnd.json(), { ok: false, error: 'dnd must be a boolean' });

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
