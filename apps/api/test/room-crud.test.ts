process.env.ROOM_CREATE_POW_DIFFICULTY = '0';

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

const { createApiApp, createApiServer } = await import('../src/server.ts');
const { resolveRealtimeReconnectLeaseMs } = await import('../src/app/config.ts');
const { openWs, sendWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType } = await import('./ws-harness.ts');
import type { ClientCommands } from '@voice-room/shared/contracts/realtime';
import type { StoredUser } from '../src/lib/user-store.ts';
import { dbRoom, userSession, type DbRoom, type Fakes } from './fakes/index.ts';
import { socketDir } from './fakes/server-process.ts';
import type { FrameOf, WsSession } from './ws-harness.ts';

const isSnapshot = (frame: { type: string }): frame is FrameOf<'room.snapshot'> => frame.type === 'room.snapshot';

const OWNER_ID = 'user-owner';
const OWNER_TOKEN = 'session-owner';
const OTHER_TOKEN = 'session-other';

test('realtime reconnect lease timeout accepts only the documented bounded range', () => {
  assert.equal(resolveRealtimeReconnectLeaseMs({}), 30000);
  assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: '1000' }), 1000);
  assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: '120000' }), 120000);
  for (const value of ['0', '-1', '999', '120001', 'NaN', '1000.5', '']) {
    assert.equal(resolveRealtimeReconnectLeaseMs({ REALTIME_RECONNECT_LEASE_MS: value }), 30000);
  }
});

// In-memory room store covering only the surface the CRUD handlers touch. It
// mirrors the real store's contract: getRoom filters soft-deleted rows, and
// updateRoom/deleteRoom return null once a room is gone.
type FakeRoom = DbRoom & { deletedAt?: number; lastReadAt?: number };
type Seed = Record<string, Partial<FakeRoom>>;

function createFakeStore(seed: Seed = {}) {
  const rooms = new Map<string, FakeRoom>();
  for (const [id, room] of Object.entries(seed)) {
    rooms.set(id, { ...dbRoom(id, { updatedAt: Date.now() }), ...room, id });
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
    async getOrCreatePeerIdentity({ peerId } = { roomId: '', peerId: '', sessionToken: '' }) {
      return { identity: { avatarColorKey: 'blurple', peerId }, status: 'created' };
    },
    normalizeGatePrincipal({
      accountUserId,
      guestPrincipalId
    }: { accountUserId?: string | null; guestPrincipalId?: string } = {}) {
      return accountUserId
        ? { principalId: accountUserId, principalType: 'account' as const }
        : { principalId: guestPrincipalId || 'test-guest', principalType: 'guest' as const };
    },
    async isRoomServerMuted() {
      return false;
    },
    async updateRoom(roomId: string, patch: Partial<FakeRoom>) {
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
    async markRoomActive() {
      return null;
    },
    async markRoomEmpty() {
      return null;
    },
    async pruneRooms() {
      return false;
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    async listVisibleRoomsForUser() {
      return [...rooms.values()]
        .filter((room) => !room.deletedAt && room.isStatic)
        .map((room) => ({ ...room, peers: new Map(), relationship: 'owner', unreadCount: room.unreadCount || 0 }));
    },
    async getRoomUnreadCount(roomId: string) {
      return rooms.get(roomId)?.unreadCount || 0;
    },
    async markRoomChatRead(roomId: string, userId: string, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room || room.deletedAt || room.ownerId !== userId) return null;
      room.unreadCount = 0;
      room.lastReadAt = now;
      return now;
    },
    async listMessages() {
      return [];
    }
  } satisfies Fakes['store'] & { rooms: Map<string, FakeRoom> };
}

function createFakeUsers(): Fakes['users'] {
  return {
    async getSessionUser(token) {
      if (token === OWNER_TOKEN) return userSession({ id: OWNER_ID });
      if (token === OTHER_TOKEN) return userSession({ id: 'user-other' });
      return null;
    }
  };
}

function staticRoom(overrides: Partial<FakeRoom> = {}): Partial<FakeRoom> {
  return {
    createdAt: Date.now(),
    isStatic: true,
    name: 'Original',
    ownerId: OWNER_ID,
    emptySince: null,
    ...overrides
  };
}

function buildApp(seed: Seed) {
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
  assert.equal(store.rooms.get('room1')?.name, 'Renamed');
});

test('room unread count is returned by auth rooms and cleared by the read endpoint', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom({ unreadCount: 3 }) });
  t.after(() => app.close());

  const listed = await app.inject({
    method: 'GET',
    url: '/api/auth/rooms',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` }
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().rooms[0].unreadCount, 3);

  const read = await app.inject({
    method: 'POST',
    url: '/api/rooms/room1/read',
    headers: { cookie: `vr_session=${OWNER_TOKEN}` }
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().unreadCount, 0);
  assert.equal(store.rooms.get('room1')?.unreadCount, 0);
});

test('room read endpoint requires auth and room visibility', async (t) => {
  const { app } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const anonymous = await app.inject({ method: 'POST', url: '/api/rooms/room1/read' });
  assert.equal(anonymous.statusCode, 401);

  const hidden = await app.inject({
    method: 'POST',
    url: '/api/rooms/room1/read',
    headers: { cookie: `vr_session=${OTHER_TOKEN}` }
  });
  assert.equal(hidden.statusCode, 404);
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
  assert.equal(store.rooms.get('room1')?.name, 'Original');
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
  assert.equal(store.rooms.get('room1')?.name, 'Original');
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
  assert.equal(store.rooms.get('room1')?.name, 'Original');
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
  assert.ok(store.rooms.get('room1')?.deletedAt);

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
  assert.equal(store.rooms.get('room1')?.deletedAt, undefined);
});

test('DELETE without a session returns 401', async (t) => {
  const { app, store } = buildApp({ room1: staticRoom() });
  t.after(() => app.close());

  const response = await app.inject({ method: 'DELETE', url: '/api/rooms/room1' });

  assert.equal(response.statusCode, 401);
  assert.equal(store.rooms.get('room1')?.deletedAt, undefined);
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
  assert.equal(store.rooms.get('room1')?.name, 'Original');

  const del = await app.inject({
    method: 'DELETE',
    url: '/api/rooms/room1',
    headers: { cookie: `vr_session=${OWNER_TOKEN}`, host: 'voice.local', origin: 'https://evil.local' }
  });
  assert.equal(del.statusCode, 403);
  assert.equal(store.rooms.get('room1')?.deletedAt, undefined);
});

const OWNER_PEER_TOKEN = 'peertoken12345678901234567890123456';
const GUEST_PEER_TOKEN = 'guesttoken12345678901234567890123456';

async function openVoiceSession(
  socketPath: string,
  { cookie = '', roomId, peerId, sessionToken, name }: ClientCommands['room.join'] & { cookie?: string }
) {
  const session = openWs(socketPath, { cookie });
  await session.ready;
  await joinVoiceRoom(session, { roomId, peerId, sessionToken, name });
  return session;
}

async function openPreviewSession(socketPath: string, roomId: string, { cookie = '' } = {}) {
  const session = openWs(socketPath, { cookie });
  await session.ready;
  await subscribeRoomPreview(session, roomId);
  return session;
}

async function startSocketServer(
  seed: Seed = {},
  { store = createFakeStore(seed), users = createFakeUsers() }: { store?: Fakes['store']; users?: Fakes['users'] } = {}
) {
  const { dir, socketPath } = socketDir('voice-room-crud-');
  const server = createApiServer({ store, users, friends: { getFriendIds: async () => [] } });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path: socketPath }, () => resolve());
  });
  return { dir, socketPath, store, server };
}

async function requestOnSocket(
  socketPath: string,
  { method, path: reqPath, body, cookie }: { method: string; path: string; body?: unknown; cookie?: string }
) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise<number | undefined>((resolve, reject) => {
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

function teardownSocketServer(
  t: TestContext,
  { server, dir, sessions = [] }: { server: http.Server; dir: string; sessions?: Array<Pick<WsSession, 'ws'>> }
) {
  t.after(async () => {
    for (const session of sessions) session.ws.close();
    server.closeAllConnections();
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

  const ownerPeer = ownerPresence.frames.find(isSnapshot)?.payload.peers.find((peer) => peer.id === 'peer0001');
  assert.ok(ownerPeer);
  assert.equal(ownerPeer.accountUserId, OWNER_ID);
  assert.equal('login' in ownerPeer, false);

  const guestSnapshot = guestPresence.frames.find(isSnapshot)?.payload;
  const guestSelf = guestSnapshot?.peers.find((peer) => peer.id === 'peer0002');
  assert.equal(guestSelf?.accountUserId, '');
  const ownerAsPeer = guestSnapshot?.peers.find((peer) => peer.id === 'peer0001');
  assert.ok(ownerAsPeer);
  assert.equal(ownerAsPeer.accountUserId, OWNER_ID);
  assert.equal('login' in ownerAsPeer, false);
});

test('room join refreshes profile identity changed after the websocket opened', async (t) => {
  const owner: Partial<StoredUser> = {
    id: OWNER_ID,
    displayName: 'Original Profile',
    login: 'owner',
    avatarAccent: null,
    avatarColorKey: 'blurple',
    avatarKey: null
  };
  const users: Fakes['users'] = {
    async getSessionUser(token) {
      return token === OWNER_TOKEN ? userSession(owner) : null;
    }
  };
  const { dir, socketPath, server } = await startSocketServer({ room1: staticRoom() }, { users });
  const presence = openWs(socketPath, { cookie: `vr_session=${OWNER_TOKEN}` });
  await presence.ready;
  const initialSnapshot = await joinVoiceRoom(presence, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Ignored initial client name'
  });
  assert.equal(initialSnapshot.payload.peers.find((entry) => entry.id === 'peer0001')?.name, 'Original Profile');

  const observer = openWs(socketPath);
  await observer.ready;
  await joinVoiceRoom(observer, {
    roomId: 'room1',
    peerId: 'peer0002',
    sessionToken: GUEST_PEER_TOKEN,
    name: 'Observer'
  });

  const replacement = openWs(socketPath, { cookie: `vr_session=${OWNER_TOKEN}` });
  await replacement.ready;

  owner.displayName = 'Current Profile';
  owner.avatarAccent = '#49303f';
  owner.avatarKey = 'av_user-owner_deadbeef.webp';
  const observerSince = observer.frames.length;
  const replacementSnapshot = await joinVoiceRoom(replacement, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Ignored client name'
  });
  const profileUpdate = await waitForWsType(
    observer.frames,
    'room.peer.updated',
    (frame) => frame.payload?.peer?.id === 'peer0001',
    5000,
    observerSince
  );
  assert.equal(profileUpdate.payload.peer.name, 'Current Profile');
  assert.equal(profileUpdate.payload.peer.avatarUrl, '/api/avatars/av_user-owner_deadbeef.webp');

  const peer = replacementSnapshot.payload.peers.find((entry) => entry.id === 'peer0001');
  assert.ok(peer);
  assert.equal(peer.name, 'Current Profile');
  assert.equal(peer.avatarAccent, '#49303f');
  assert.equal(peer.avatarColorKey, 'blurple');
  assert.equal(peer.avatarUrl, '/api/avatars/av_user-owner_deadbeef.webp');

  const spoofSince = observer.frames.length;
  sendWs(replacement.ws, 'room.peer.update', {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: OWNER_PEER_TOKEN,
    patch: { muted: true, name: 'Spoofed account name' }
  });
  const spoofUpdate = await waitForWsType(
    observer.frames,
    'room.peer.updated',
    (frame) => frame.payload?.peer?.id === 'peer0001',
    5000,
    spoofSince
  );
  assert.equal(spoofUpdate.payload.peer.muted, true);
  assert.equal(spoofUpdate.payload.peer.name, 'Current Profile');

  const guestReplacement = openWs(socketPath);
  await guestReplacement.ready;
  const guestSnapshot = await joinVoiceRoom(guestReplacement, {
    roomId: 'room1',
    peerId: 'peer0002',
    sessionToken: GUEST_PEER_TOKEN,
    name: 'Attempted guest reconnect rename'
  });
  assert.equal(guestSnapshot.payload.peers.find((entry) => entry.id === 'peer0002')?.name, 'Observer');

  teardownSocketServer(t, {
    server,
    dir,
    sessions: [presence, observer, replacement, guestReplacement]
  });
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
  store.deleteRoom = async () => null;
  const { dir, socketPath, server } = await startSocketServer({}, { store });
  const preview = await openPreviewSession(socketPath, 'room1');
  teardownSocketServer(t, { server, dir, sessions: [preview] });

  const deleteStatus = await requestOnSocket(socketPath, {
    method: 'DELETE',
    path: '/api/rooms/room1',
    cookie: `vr_session=${OWNER_TOKEN}`
  });
  assert.equal(deleteStatus, 404);
  await assert.rejects(
    waitForWsType(preview.frames, 'room.deleted', () => true, 150),
    /room.deleted/
  );
});
