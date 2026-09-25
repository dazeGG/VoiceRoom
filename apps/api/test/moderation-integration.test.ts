process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.ROOM_CHAT_RATE_LIMIT = '0';
process.env.TRUST_PROXY = 'true';
process.env.LIVEKIT_URL = 'ws://127.0.0.1:1';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';

const { createApiServer } = await import('../src/server.ts');
const { openWs, joinVoiceRoom, sendWs, waitForWsType } = await import('./ws-harness.ts');
import type { WsSession } from './ws-harness.ts';
import type { PeerBanned } from '@voice-room/shared/contracts/rooms';
import { dbRoom, storedUser, userSession, type Fakes } from './fakes/index.ts';
import { request, socketDir, type ApiBody } from './fakes/server-process.ts';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_COOKIE = 'vr_session=owner-session';
const TARGET_COOKIE = 'vr_session=target-session';
// Account bans must stay account-scoped even when several participants share
// one public address behind NAT (or run locally during development).
const OWNER_IP = '198.51.100.10';
const TARGET_IP = OWNER_IP;
const GUEST_IP = '192.0.2.44';
const ROOM_ID = 'moderation-room';
const OWNER_PEER_ID = 'owner-peer';
const TARGET_PEER_ID = 'target-peer';
const OWNER_PEER_TOKEN = 'o'.repeat(32);
const TARGET_PEER_TOKEN = 't'.repeat(32);

function createModerationStore() {
  const room = dbRoom(ROOM_ID, {
    createdAt: Date.now(),
    name: 'Moderated room',
    ownerId: OWNER_ID,
    updatedAt: Date.now()
  });
  type Ban = { id: string; roomId: string; userId: string | null; ip: string };
  type Identity = {
    avatarColorKey: string;
    peerId: string;
    roomId: string;
    sessionToken: unknown;
    invalidated?: boolean;
  };
  const bans = new Map<string, Ban>();
  const identities = new Map<string, Identity>();
  const messages: Array<Record<string, unknown>> = [];

  return {
    bans,
    identities,
    messages,
    async appendMessage(roomId, message) {
      if (roomId !== ROOM_ID) return null;
      const stored = { ...message, roomId };
      messages.push(stored);
      return stored;
    },
    async countRooms() {
      return 1;
    },
    async createRoomBan({ roomId = '', userId, ip } = {}) {
      const ban: Ban = {
        id: crypto.randomUUID(),
        roomId,
        userId: typeof userId === 'string' && userId ? userId : null,
        ip: typeof ip === 'string' ? ip : ''
      };
      bans.set(ban.id, ban);
      return { ban, status: 'created' };
    },
    async deleteRoomBan({ roomId, banId = '' } = {}) {
      const ban = bans.get(banId);
      if (!ban || ban.roomId !== roomId) return { ban: null, status: 'not_found' };
      bans.delete(banId);
      return { ban, status: 'deleted' };
    },
    async findActiveRoomBan({ roomId, userId, ip } = {}) {
      return (
        [...bans.values()].find(
          (ban) => ban.roomId === roomId && ((userId && ban.userId === userId) || (!ban.userId && ip && ban.ip === ip))
        ) || null
      );
    },
    async getOrCreatePeerIdentity({ roomId, peerId, sessionToken }) {
      const key = `${roomId}:${peerId}`;
      const existing = identities.get(key);
      if (existing && existing.sessionToken !== sessionToken) {
        return { identity: existing, status: 'token_mismatch' };
      }
      if (existing?.invalidated) return { identity: existing, status: 'token_mismatch' };
      const identity = existing || { avatarColorKey: 'blurple', peerId, roomId, sessionToken };
      identities.set(key, identity);
      return { identity, status: existing ? 'reused' : 'created' };
    },
    normalizeGatePrincipal({
      accountUserId,
      guestPrincipalId
    }: { accountUserId?: string | null; guestPrincipalId?: string } = {}) {
      return accountUserId
        ? { principalId: accountUserId, principalType: 'account' as const }
        : { principalId: guestPrincipalId || '', principalType: 'guest' as const };
    },
    async isRoomServerMuted() {
      return false;
    },
    async getRoom(roomId) {
      return roomId === ROOM_ID ? { ...room, peers: new Map() } : null;
    },
    async invalidatePeerIdentity({ roomId, peerId } = {}) {
      const identity = identities.get(`${roomId}:${peerId}`);
      if (!identity) return false;
      identity.invalidated = true;
      return true;
    },
    async listMessages() {
      return messages;
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    async listVisibleRoomsForUser() {
      return [];
    },
    async markRoomActive() {
      return null;
    },
    async markRoomEmpty() {
      return null;
    },
    async pruneRooms() {
      return false;
    }
  } satisfies Fakes['store'] & { bans: Map<string, Ban>; identities: Map<string, Identity>; messages: unknown[] };
}

function createUsers(): Fakes['users'] {
  const users = new Map([
    [OWNER_ID, storedUser({ id: OWNER_ID, displayName: 'Owner', login: 'owner' })],
    [TARGET_ID, storedUser({ id: TARGET_ID, displayName: 'Target', login: 'target' })]
  ]);
  const sessions: Record<string, string> = { 'owner-session': OWNER_ID, 'target-session': TARGET_ID };
  return {
    async getUserById(userId) {
      return users.get(userId) || null;
    },
    async getSessionUser(token) {
      const userId = typeof token === 'string' ? sessions[token] : undefined;
      return userId ? userSession(users.get(userId)) : null;
    }
  };
}

function requestJson<Body = ApiBody>(
  socketPath: string,
  method: string,
  pathname: string,
  { body, cookie = '', ip = '' }: { body?: unknown; cookie?: string; ip?: string } = {}
) {
  return request<Body>(socketPath, {
    method,
    pathname,
    body,
    cookie: cookie || undefined,
    headers: ip ? { 'X-Forwarded-For': ip } : {}
  });
}

async function startServer() {
  const { dir, socketPath } = socketDir('voice-room-moderation-');
  const store = createModerationStore();
  const server = createApiServer({
    store,
    users: createUsers(),
    friends: { getFriendIds: async () => [] },
    liveKitCredentials: {
      async issueAdmission() {
        return {
          status: 'issued',
          admission: {
            gateCredentialId: 'cred-1',
            room: ROOM_ID,
            token: 'jwt',
            ttlSeconds: 60,
            url: 'ws://gate.test/rtc'
          }
        };
      }
    },
    membershipServicesOverride: {
      service: {
        async persistSuccessfulAdmission() {
          return { created: false, status: 'active' };
        }
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path: socketPath }, () => resolve());
  });
  return { dir, server, socketPath, store };
}

function openSession(socketPath: string, cookie: string, ip: string) {
  return openWs(socketPath, { cookie, headers: { 'X-Forwarded-For': ip } });
}

async function stopServer({ dir, server }: { dir: string; server: http.Server }, sessions: WsSession[]) {
  for (const session of sessions) session.ws.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}

test('kick and ban lifecycle enforces join, token, chat, preview, and undo', async (t) => {
  const nativeFetch = global.fetch;
  global.fetch = async () =>
    new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  t.after(() => {
    global.fetch = nativeFetch;
  });
  const fixture = await startServer();
  const sessions: WsSession[] = [];
  t.after(() => stopServer(fixture, sessions));

  const owner = openSession(fixture.socketPath, OWNER_COOKIE, OWNER_IP);
  const target = openSession(fixture.socketPath, TARGET_COOKIE, TARGET_IP);
  sessions.push(owner, target);
  await Promise.all([owner.ready, target.ready]);
  await joinVoiceRoom(owner, {
    roomId: ROOM_ID,
    peerId: OWNER_PEER_ID,
    sessionToken: OWNER_PEER_TOKEN,
    name: 'Owner'
  });
  await joinVoiceRoom(target, {
    roomId: ROOM_ID,
    peerId: TARGET_PEER_ID,
    sessionToken: TARGET_PEER_TOKEN,
    name: 'Target'
  });

  const kickStart = target.frames.length;
  const kick = await requestJson(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/kick`, {
    body: { peerId: TARGET_PEER_ID },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(kick.status, 200);
  await waitForWsType(target.frames, 'room.kicked', (frame) => frame.payload.roomId === ROOM_ID, 5000, kickStart);

  const kickedState = await requestJson(fixture.socketPath, 'POST', '/api/state', {
    body: { roomId: ROOM_ID, peerId: TARGET_PEER_ID, sessionToken: TARGET_PEER_TOKEN, muted: true },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(kickedState.status, 403);

  const oldJoinStart = target.frames.length;
  sendWs(target.ws, 'room.join', {
    roomId: ROOM_ID,
    peerId: TARGET_PEER_ID,
    sessionToken: TARGET_PEER_TOKEN,
    name: 'Target'
  });
  const rejectedOldJoin = await waitForWsType(target.frames, 'error', () => true, 5000, oldJoinStart);
  assert.equal(rejectedOldJoin.error.code, 'superseded_join');

  const freshPeerId = 'target-fresh-peer';
  const freshPeerToken = 'f'.repeat(32);
  await joinVoiceRoom(target, {
    roomId: ROOM_ID,
    peerId: freshPeerId,
    sessionToken: freshPeerToken,
    name: 'Target'
  });

  const banStart = target.frames.length;
  const ownerFramesBeforeBan = owner.frames.length;
  const ban = await requestJson<PeerBanned>(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/ban`, {
    body: { peerId: freshPeerId },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(ban.status, 201);
  assert.match(ban.body.banId, /^[0-9a-f-]{36}$/i);
  const storedAccountBan = fixture.store.bans.get(ban.body.banId);
  assert.equal(storedAccountBan?.userId, TARGET_ID);
  assert.equal(storedAccountBan.ip, '');
  await waitForWsType(target.frames, 'room.banned', (frame) => frame.payload.roomId === ROOM_ID, 5000, banStart);
  assert.equal(
    owner.frames.slice(ownerFramesBeforeBan).some((frame) => frame.type === 'room.banned'),
    false
  );

  const ownerState = await requestJson(fixture.socketPath, 'POST', '/api/state', {
    body: { roomId: ROOM_ID, peerId: OWNER_PEER_ID, sessionToken: OWNER_PEER_TOKEN },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(ownerState.status, 200);

  const bannedState = await requestJson(fixture.socketPath, 'POST', '/api/state', {
    body: { roomId: ROOM_ID, peerId: freshPeerId, sessionToken: freshPeerToken, muted: true },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(bannedState.status, 403);
  assert.equal(bannedState.body.code, 'room_banned');

  const bannedJoinStart = target.frames.length;
  sendWs(target.ws, 'room.join', {
    roomId: ROOM_ID,
    peerId: 'target-after-ban',
    sessionToken: 'b'.repeat(32),
    name: 'Target'
  });
  await waitForWsType(target.frames, 'room.banned', (frame) => frame.payload.roomId === ROOM_ID, 5000, bannedJoinStart);

  const sameIpGuest = openSession(fixture.socketPath, '', TARGET_IP);
  sessions.push(sameIpGuest);
  await sameIpGuest.ready;
  await joinVoiceRoom(sameIpGuest, {
    roomId: ROOM_ID,
    peerId: 'same-ip-guest',
    sessionToken: 's'.repeat(32),
    name: 'Same IP guest'
  });
  assert.equal(
    sameIpGuest.frames.some((frame) => frame.type === 'room.banned'),
    false
  );

  const token = await requestJson(fixture.socketPath, 'POST', '/api/livekit-token', {
    body: { roomId: ROOM_ID, peerId: 'target-after-ban', sessionToken: 'b'.repeat(32), name: 'Target' },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(token.status, 403);
  assert.equal(token.body.code, 'room_banned');

  const chat = await requestJson(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/chat`, {
    body: { text: 'blocked message' },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(chat.status, 403);
  assert.equal(chat.body.code, 'room_banned');
  assert.equal(fixture.store.messages.length, 0);

  const preview = openSession(fixture.socketPath, TARGET_COOKIE, TARGET_IP);
  sessions.push(preview);
  await preview.ready;
  sendWs(preview.ws, 'room.preview.subscribe', { roomId: ROOM_ID });
  await waitForWsType(preview.frames, 'room.banned', (frame) => frame.payload.roomId === ROOM_ID);
  assert.equal(
    preview.frames.some((frame) => frame.type === 'room.snapshot'),
    false
  );

  const undo = await requestJson(fixture.socketPath, 'DELETE', `/api/rooms/${ROOM_ID}/bans/${ban.body.banId}`, {
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(undo.status, 200);
  assert.equal(fixture.store.bans.size, 0);

  const previewAfterUndoStart = preview.frames.length;
  sendWs(preview.ws, 'room.preview.subscribe', { roomId: ROOM_ID });
  await waitForWsType(
    preview.frames,
    'room.snapshot',
    (frame) => frame.payload.roomId === ROOM_ID,
    5000,
    previewAfterUndoStart
  );

  // Media admission is only for peers in the room roster, so rejoin first.
  await joinVoiceRoom(target, {
    roomId: ROOM_ID,
    peerId: 'target-after-undo',
    sessionToken: 'u'.repeat(32),
    name: 'Target'
  });
  const tokenAfterUndo = await requestJson(fixture.socketPath, 'POST', '/api/livekit-token', {
    body: { roomId: ROOM_ID, peerId: 'target-after-undo', sessionToken: 'u'.repeat(32), name: 'Target' },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(tokenAfterUndo.status, 200);

  const chatAfterUndo = await requestJson(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/chat`, {
    body: { text: 'allowed after undo' },
    cookie: TARGET_COOKIE,
    ip: TARGET_IP
  });
  assert.equal(chatAfterUndo.status, 201);
  assert.equal(fixture.store.messages.length, 1);

  await joinVoiceRoom(preview, {
    roomId: ROOM_ID,
    peerId: 'target-after-undo',
    sessionToken: 'u'.repeat(32),
    name: 'Target'
  });

  const guest = openSession(fixture.socketPath, '', GUEST_IP);
  sessions.push(guest);
  await guest.ready;
  const guestPeerId = 'guest-peer';
  const guestPeerToken = 'g'.repeat(32);
  await joinVoiceRoom(guest, {
    roomId: ROOM_ID,
    peerId: guestPeerId,
    sessionToken: guestPeerToken,
    name: 'Guest'
  });

  const guestBan = await requestJson<PeerBanned>(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/ban`, {
    body: { peerId: guestPeerId },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(guestBan.status, 201);
  const storedGuestBan = fixture.store.bans.get(guestBan.body.banId);
  assert.equal(storedGuestBan?.userId, null);
  assert.equal(storedGuestBan.ip, GUEST_IP);

  const guestState = await requestJson(fixture.socketPath, 'POST', '/api/state', {
    body: { roomId: ROOM_ID, peerId: guestPeerId, sessionToken: guestPeerToken, muted: true },
    ip: GUEST_IP
  });
  assert.equal(guestState.status, 403);
  assert.equal(guestState.body.code, 'room_banned');

  const returningGuest = openSession(fixture.socketPath, '', GUEST_IP);
  sessions.push(returningGuest);
  await returningGuest.ready;
  const returningGuestStart = returningGuest.frames.length;
  sendWs(returningGuest.ws, 'room.join', {
    roomId: ROOM_ID,
    peerId: 'returning-guest',
    sessionToken: 'r'.repeat(32),
    name: 'Returning guest'
  });
  await waitForWsType(
    returningGuest.frames,
    'room.banned',
    (frame) => frame.payload.roomId === ROOM_ID,
    5000,
    returningGuestStart
  );
});
