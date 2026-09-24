process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

import test from 'node:test';
import assert from 'node:assert/strict';

import { TrackSource } from 'livekit-server-sdk';
const { createApiApp } = await import('../src/server.ts');
const { isLiveKitParticipantAlreadyGone, resolveServerMutePermission } = await import('../src/domains/admission/livekit-admin.ts');

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BOB_ID = '22222222-2222-4222-8222-222222222222';

function createStore({ muteLookup = async () => false, removeBookmark = async () => ({ removed: false, status: 'removed' }) } = {}) {
  const rooms = new Map([['context-room', {
    id: 'context-room',
    name: 'Context room',
    isStatic: true,
    ownerId: ALICE_ID,
    peers: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]]);
  return {
    async countQuotaRoomsForIp() { return 0; },
    async countRooms() { return rooms.size; },
    async getRoom(roomId) { return rooms.get(roomId) || null; },
    async getOrCreatePeerIdentity({ peerId }) {
      return { status: 'created', identity: { peerId, avatarColorKey: 'blurple' } };
    },
    normalizeGatePrincipal({ accountUserId, guestPrincipalId }) {
      return accountUserId
        ? { principalId: accountUserId, principalType: 'account' }
        : { principalId: guestPrincipalId, principalType: 'guest' };
    },
    isRoomServerMuted: muteLookup,
    removeRoomBookmarkForUser: removeBookmark,
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {},
    async listSummaryRecipientUserIds() { return []; }
  };
}

test('room list removal rejects owners and removes only bookmarked rooms', async (t) => {
  const calls = [];
  const app = createApiApp({
    store: createStore({
      removeBookmark: async (userId, roomId) => {
        calls.push({ userId, roomId });
        return userId === ALICE_ID
          ? { removed: false, status: 'owner' }
          : { removed: true, status: 'removed' };
      }
    }),
    users: createUsers()
  });
  t.after(() => app.close());

  const owner = await app.inject({
    method: 'DELETE',
    url: '/api/auth/rooms/context-room',
    headers: { cookie: 'vr_session=alice-session' }
  });
  assert.equal(owner.statusCode, 403);
  assert.equal(owner.json().code, 'room_owner');

  const member = await app.inject({
    method: 'DELETE',
    url: '/api/auth/rooms/context-room',
    headers: { cookie: 'vr_session=bob-session' }
  });
  assert.equal(member.statusCode, 200);
  assert.equal(member.json().removed, true);
  assert.deepEqual(calls, [
    { userId: ALICE_ID, roomId: 'context-room' },
    { userId: BOB_ID, roomId: 'context-room' }
  ]);
});

function createUsers() {
  return {
    async getSessionUser(token) {
      if (token === 'alice-session') return { user: { id: ALICE_ID, login: 'alice', displayName: 'Alice' } };
      if (token === 'bob-session') return { user: { id: BOB_ID, login: 'bob', displayName: 'Bob' } };
      return null;
    }
  };
}

test('a block in either direction rejects direct-message sends before persistence', async (t) => {
  let sends = 0;
  const app = createApiApp({
    store: createStore(),
    users: createUsers(),
    friends: {
      async areFriends() { return true; },
      async isBlockedBetween() { return true; },
      async sendMessage() { sends += 1; throw new Error('must not persist'); }
    }
  });
  t.after(() => app.close());

  for (const [session, peerId] of [['alice-session', BOB_ID], ['bob-session', ALICE_ID]]) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/dm/${peerId}`,
      headers: { cookie: `vr_session=${session}` },
      payload: { text: 'blocked message' }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'relationship_blocked');
  }
  assert.equal(sends, 0);
});

test('a block in either direction rejects room rings before invite persistence', async (t) => {
  let sends = 0;
  const app = createApiApp({
    store: createStore(),
    users: createUsers(),
    friends: {
      async areFriends() { return true; },
      async isBlockedBetween() { return true; },
      async sendMessage() { sends += 1; throw new Error('must not persist'); }
    }
  });
  t.after(() => app.close());

  for (const [session, userId] of [['alice-session', BOB_ID], ['bob-session', ALICE_ID]]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms/context-room/ring',
      headers: { cookie: `vr_session=${session}` },
      payload: { userId }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'relationship_blocked');
  }
  assert.equal(sends, 0);
});

test('LiveKit admission fails closed when persisted server-mute lookup fails', async (t) => {
  let issued = 0;
  const store = createStore({ muteLookup: async () => { throw new Error('database unavailable'); } });
  // Admission is only for peers already in the room roster.
  (await store.getRoom('context-room')).peers.set('peer-alice', {
    id: 'peer-alice', name: 'Alice', sessionToken: 'goodtoken123456789012345678901234'
  });
  const app = createApiApp({
    store,
    users: createUsers(),
    liveKitCredentials: {
      async issueAdmission() {
        issued += 1;
        return { status: 'issued', admission: { room: 'voice-room-context', token: 'jwt', ttlSeconds: 60, url: 'ws://gate' } };
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/livekit-token',
    headers: { cookie: 'vr_session=alice-session' },
    payload: {
      name: 'Alice',
      peerId: 'peer-alice',
      roomId: 'context-room',
      sessionToken: 'goodtoken123456789012345678901234'
    }
  });

  assert.equal(response.statusCode, 503);
  assert.equal(issued, 0);
});

test('microphone server mute preserves unrelated LiveKit permissions and screen publishing', () => {
  const original = {
    canPublish: true,
    canPublishData: false,
    canSubscribe: false,
    hidden: true,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO
    ]
  };

  const muted = resolveServerMutePermission(original, true);
  assert.deepEqual(muted.canPublishSources, [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
  assert.equal(muted.canPublish, true);
  assert.equal(muted.canPublishData, false);
  assert.equal(muted.canSubscribe, false);
  assert.equal(muted.hidden, true);

  const unmuted = resolveServerMutePermission(muted, false);
  assert.deepEqual(unmuted.canPublishSources, [
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
    TrackSource.MICROPHONE
  ]);
  assert.equal(unmuted.canPublishData, false);
  assert.equal(unmuted.canSubscribe, false);
});

// Taken verbatim from production on 2026-09-22: every normal leave logged an
// error because the suppression matched only `message`, which says nothing
// about Not Found. A participant the SFU has already dropped is the outcome
// the removal wants, so it must not reach the error stream.
test('a participant the SFU has already dropped is not an error', () => {
  const production = Object.assign(new Error('twirp error unknown: participant does not exist'), {
    name: 'Not Found',
    status: 404,
    code: 'not_found'
  });
  assert.equal(isLiveKitParticipantAlreadyGone(production), true);

  // Each signal on its own is enough: the SDK has changed shape before.
  assert.equal(isLiveKitParticipantAlreadyGone({ status: 404 }), true);
  assert.equal(isLiveKitParticipantAlreadyGone({ code: 'not_found' }), true);
  assert.equal(isLiveKitParticipantAlreadyGone({ name: 'Not Found' }), true);
  assert.equal(isLiveKitParticipantAlreadyGone({ message: 'participant does not exist' }), true);
});

test('a real removal failure still reaches the error stream', () => {
  const upstream = Object.assign(new Error('twirp error internal: connection refused'), {
    name: 'Internal',
    status: 500,
    code: 'internal'
  });
  assert.equal(isLiveKitParticipantAlreadyGone(upstream), false);
  assert.equal(isLiveKitParticipantAlreadyGone(new Error('permission denied')), false);
  assert.equal(isLiveKitParticipantAlreadyGone(undefined), false);
});
