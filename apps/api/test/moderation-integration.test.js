'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.ROOM_CHAT_RATE_LIMIT = '0';
process.env.TRUST_PROXY = 'true';
process.env.LIVEKIT_URL = 'ws://127.0.0.1:1';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { createApiServer } = require('../src/server');
const { openWs, joinVoiceRoom, sendWs, waitForWsType } = require('./ws-harness');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_COOKIE = 'vr_session=owner-session';
const TARGET_COOKIE = 'vr_session=target-session';
const OWNER_IP = '198.51.100.10';
const TARGET_IP = '203.0.113.20';
const ROOM_ID = 'moderation-room';
const OWNER_PEER_ID = 'owner-peer';
const TARGET_PEER_ID = 'target-peer';
const OWNER_PEER_TOKEN = 'o'.repeat(32);
const TARGET_PEER_TOKEN = 't'.repeat(32);

function createModerationStore() {
  const room = {
    createdAt: Date.now(),
    emptySince: null,
    id: ROOM_ID,
    isStatic: true,
    name: 'Moderated room',
    ownerId: OWNER_ID,
    updatedAt: Date.now()
  };
  const bans = new Map();
  const identities = new Map();
  const messages = [];

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
    async createRoomBan({ roomId, userId, ip }) {
      const ban = {
        id: crypto.randomUUID(),
        roomId,
        userId: userId || null,
        ip: ip || ''
      };
      bans.set(ban.id, ban);
      return { ban, status: 'created' };
    },
    async deleteRoomBan({ roomId, banId }) {
      const ban = bans.get(banId);
      if (!ban || ban.roomId !== roomId) return { ban: null, status: 'not_found' };
      bans.delete(banId);
      return { ban, status: 'deleted' };
    },
    async findActiveRoomBan({ roomId, userId, ip }) {
      return [...bans.values()].find((ban) =>
        ban.roomId === roomId && ((userId && ban.userId === userId) || (ip && ban.ip === ip))
      ) || null;
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
    async getRoom(roomId) {
      return roomId === ROOM_ID ? { ...room, peers: new Map() } : null;
    },
    async invalidatePeerIdentity({ roomId, peerId }) {
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
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {}
  };
}

function createUsers() {
  const users = new Map([
    [OWNER_ID, { id: OWNER_ID, displayName: 'Owner', login: 'owner' }],
    [TARGET_ID, { id: TARGET_ID, displayName: 'Target', login: 'target' }]
  ]);
  return {
    async getUserById(userId) {
      return users.get(userId) || null;
    },
    async getSessionUser(token) {
      if (token === 'owner-session') {
        return { user: users.get(OWNER_ID) };
      }
      if (token === 'target-session') {
        return { user: users.get(TARGET_ID) };
      }
      return null;
    }
  };
}

function createFriends() {
  return { async getFriendIds() { return []; } };
}

async function requestJson(socketPath, method, pathname, { body, cookie = '', ip = '' } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      method,
      path: pathname,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {})
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: responseBody ? JSON.parse(responseBody) : null
      }));
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function startServer() {
  const dir = fs.mkdtempSync(path.join('/private/tmp', 'voice-room-moderation-'));
  const socketPath = path.join(dir, 'api.sock');
  const store = createModerationStore();
  const server = createApiServer({ store, users: createUsers(), friends: createFriends() });
  await new Promise((resolve, reject) => {
    server.listen({ path: socketPath }, (error) => error ? reject(error) : resolve());
  });
  return { dir, server, socketPath, store };
}

function openSession(socketPath, cookie, ip) {
  return openWs(socketPath, { cookie, headers: { 'X-Forwarded-For': ip } });
}

async function stopServer({ dir, server }, sessions) {
  for (const session of sessions) session.ws.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}

test('kick and ban lifecycle enforces join, token, chat, preview, and undo', async (t) => {
  const nativeFetch = global.fetch;
  global.fetch = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  t.after(() => { global.fetch = nativeFetch; });
  const fixture = await startServer();
  const sessions = [];
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
  assert.equal(rejectedOldJoin.error.code, 'invalid_session');

  const freshPeerId = 'target-fresh-peer';
  const freshPeerToken = 'f'.repeat(32);
  await joinVoiceRoom(target, {
    roomId: ROOM_ID,
    peerId: freshPeerId,
    sessionToken: freshPeerToken,
    name: 'Target'
  });

  const banStart = target.frames.length;
  const ban = await requestJson(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/ban`, {
    body: { peerId: freshPeerId },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(ban.status, 201);
  assert.match(ban.body.banId, /^[0-9a-f-]{36}$/i);
  await waitForWsType(target.frames, 'room.banned', (frame) => frame.payload.roomId === ROOM_ID, 5000, banStart);

  const bannedJoinStart = target.frames.length;
  sendWs(target.ws, 'room.join', {
    roomId: ROOM_ID,
    peerId: 'target-after-ban',
    sessionToken: 'b'.repeat(32),
    name: 'Target'
  });
  await waitForWsType(target.frames, 'room.banned', (frame) => frame.payload.roomId === ROOM_ID, 5000, bannedJoinStart);

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
  assert.equal(preview.frames.some((frame) => frame.type === 'room.snapshot'), false);

  const undo = await requestJson(fixture.socketPath, 'DELETE', `/api/rooms/${ROOM_ID}/bans/${ban.body.banId}`, {
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(undo.status, 200);
  assert.equal(fixture.store.bans.size, 0);

  const previewAfterUndoStart = preview.frames.length;
  sendWs(preview.ws, 'room.preview.subscribe', { roomId: ROOM_ID });
  await waitForWsType(preview.frames, 'room.snapshot', (frame) => frame.payload.roomId === ROOM_ID, 5000, previewAfterUndoStart);

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
});
