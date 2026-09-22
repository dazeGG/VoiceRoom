'use strict';

// End-to-end proofs for the authorization gaps closed after the 2.6.4 audit:
// a guest could claim a signed-in user's `auth-<id>` peer id and rewrite their
// messages, banned visitors could still read the room, anyone with a room id
// could take a LiveKit admission without joining, cookie writes and WebSocket
// handshakes accepted any Origin, logins were only throttled per address, and a
// server mute left the pre-mute admission usable for a reconnect.

const { socketPathForDirectory } = require('./ipc-harness');
process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.ROOM_CHAT_RATE_LIMIT = '0';
process.env.TRUST_PROXY = 'true';
process.env.LIVEKIT_URL = 'ws://127.0.0.1:1';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_GATE_SECRET = 'audit-hardening-gate-secret-at-least-32-bytes';
process.env.LIVEKIT_ROSTER_WAIT_MS = '150';
process.env.LOGIN_FAILURE_LIMIT = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApiServer } = require('../src/server');
const { openWs, joinVoiceRoom, sendWs, waitForWsType } = require('./ws-harness');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VICTIM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_COOKIE = 'vr_session=owner-session';
const VICTIM_COOKIE = 'vr_session=victim-session';
const OWNER_IP = '198.51.100.10';
const VICTIM_IP = '198.51.100.20';
const GUEST_IP = '192.0.2.44';
const BANNED_IP = '192.0.2.99';
const ROOM_ID = 'hardening-room';

function createStore() {
  const room = {
    createdAt: Date.now(),
    emptySince: null,
    id: ROOM_ID,
    isStatic: true,
    name: 'Hardening room',
    ownerId: OWNER_ID,
    updatedAt: Date.now()
  };
  const bans = [];
  const identities = new Map();
  const messages = [];
  const revokedPrincipals = [];
  const serverMutes = new Set();

  return {
    bans,
    messages,
    revokedPrincipals,
    async appendMessage(roomId, message) {
      const stored = { id: message.id || crypto.randomUUID(), ...message, roomId };
      messages.push(stored);
      return stored;
    },
    async getMessage(roomId, messageId) {
      return messages.find((message) => message.roomId === roomId && message.id === messageId && !message.deleted) || null;
    },
    async editMessage(roomId, messageId, text) {
      const message = await this.getMessage(roomId, messageId);
      if (!message) return null;
      message.text = text;
      message.editedAt = Date.now();
      return message;
    },
    async softDeleteMessage(roomId, messageId) {
      const message = await this.getMessage(roomId, messageId);
      if (!message) return null;
      message.deleted = true;
      return message;
    },
    async listMessages() {
      return messages.filter((message) => !message.deleted);
    },
    async countRooms() {
      return 1;
    },
    async findActiveRoomBan({ roomId, userId, ip }) {
      return bans.find((ban) => ban.roomId === roomId && ((userId && ban.userId === userId) || (!ban.userId && ip && ban.ip === ip))) || null;
    },
    async getOrCreatePeerIdentity({ roomId, peerId, sessionToken }) {
      const key = `${roomId}:${peerId}`;
      const existing = identities.get(key);
      if (existing && existing.sessionToken !== sessionToken) return { identity: existing, status: 'token_mismatch' };
      const identity = existing || { avatarColorKey: 'blurple', id: `guest-${peerId}`, peerId, roomId, sessionToken };
      identities.set(key, identity);
      return { identity, status: existing ? 'reused' : 'created' };
    },
    normalizeGatePrincipal({ accountUserId, guestPrincipalId }) {
      return accountUserId
        ? { principalId: accountUserId, principalType: 'account' }
        : { principalId: guestPrincipalId || 'guest', principalType: 'guest' };
    },
    async isRoomServerMuted({ principal }) {
      return serverMutes.has(`${principal.principalType}:${principal.principalId}`);
    },
    async setRoomServerMute({ principal }) {
      serverMutes.add(`${principal.principalType}:${principal.principalId}`);
      return { status: 'muted' };
    },
    async clearRoomServerMute({ principal }) {
      serverMutes.delete(`${principal.principalType}:${principal.principalId}`);
      return { status: 'cleared' };
    },
    async getLiveKitGatePrincipalEpoch() {
      return { status: 'ready', epoch: 0 };
    },
    async createLiveKitGateCredential() {
      return { status: 'created' };
    },
    async verifyLiveKitGateCredential() {
      return { status: 'allowed' };
    },
    async revokeLiveKitGatePrincipal({ principal, roomId }) {
      revokedPrincipals.push({ roomId, ...principal });
      return { status: 'revoked', epoch: revokedPrincipals.length };
    },
    async getRoom(roomId) {
      return roomId === ROOM_ID ? { ...room, peers: new Map() } : null;
    },
    async invalidatePeerIdentity() {
      return true;
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
    [VICTIM_ID, { id: VICTIM_ID, displayName: 'Victim', login: 'victim' }]
  ]);
  return {
    async getUserById(userId) {
      return users.get(userId) || null;
    },
    async getSessionUser(token) {
      if (token === 'owner-session') return { user: users.get(OWNER_ID) };
      if (token === 'victim-session') return { user: users.get(VICTIM_ID) };
      return null;
    },
    async verifyCredentials() {
      return null;
    }
  };
}

function request(socketPath, method, pathname, { body, cookie = '', ip = '', headers = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      method,
      path: pathname,
      headers: {
        Accept: 'application/json',
        Host: 'localhost',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
        ...headers
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = responseBody ? JSON.parse(responseBody) : null;
        } catch {
          parsed = responseBody;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-hardening-'));
  const socketPath = socketPathForDirectory(dir);
  const store = createStore();
  const issued = [];
  const server = createApiServer({
    store,
    users: createUsers(),
    friends: { async getFriendIds() { return []; } },
    liveKitCredentials: {
      async issueAdmission(input) {
        issued.push(input);
        return { status: 'issued', admission: { gateCredentialId: crypto.randomUUID(), room: ROOM_ID, token: 'jwt', ttlSeconds: 60, url: 'ws://gate.test/rtc' } };
      }
    },
    membershipServicesOverride: {
      service: { async persistSuccessfulAdmission() { return { created: false, status: 'active' }; } }
    }
  });
  await new Promise((resolve, reject) => {
    server.listen({ path: socketPath }, (error) => (error ? reject(error) : resolve()));
  });
  const sessions = [];
  t.after(async () => {
    for (const session of sessions) session.ws.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const open = (cookie, ip, headers = {}) => {
    const session = openWs(socketPath, { cookie, headers: { 'X-Forwarded-For': ip, ...headers } });
    sessions.push(session);
    return session;
  };
  return { issued, open, socketPath, store };
}

function mockLiveKitAdmin(t) {
  const nativeFetch = global.fetch;
  global.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  t.after(() => { global.fetch = nativeFetch; });
}

test('a guest cannot claim an account peer id or rewrite an account-authored message', async (t) => {
  mockLiveKitAdmin(t);
  const fixture = await startServer(t);
  const accountPeerId = `auth-${VICTIM_ID}`;

  // The victim writes from the lobby preview, which files the message under
  // their account peer id.
  const posted = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/chat`, {
    body: { peerId: accountPeerId, text: 'original' },
    cookie: VICTIM_COOKIE,
    ip: VICTIM_IP
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));
  const messageId = posted.body.message.id;
  assert.equal(fixture.store.messages[0].peerId, accountPeerId);
  assert.equal(fixture.store.messages[0].authorUserId, VICTIM_ID);

  const attacker = fixture.open('', GUEST_IP);
  await attacker.ready;
  const claimStart = attacker.frames.length;
  sendWs(attacker.ws, 'room.join', { roomId: ROOM_ID, peerId: accountPeerId, sessionToken: 'a'.repeat(32), name: 'Attacker' });
  const refused = await waitForWsType(attacker.frames, 'error', () => true, 5000, claimStart);
  assert.equal(refused.error.code, 'invalid_join');

  // Joined under a peer id of their own, the attacker still cannot act on the
  // account's message by naming the account peer id or their own.
  await joinVoiceRoom(attacker, { roomId: ROOM_ID, peerId: 'attacker-peer', sessionToken: 'a'.repeat(32), name: 'Attacker' });
  for (const peerId of [accountPeerId, 'attacker-peer']) {
    const edit = await request(fixture.socketPath, 'PATCH', `/api/rooms/${ROOM_ID}/chat/${messageId}`, {
      body: { peerId, sessionToken: 'a'.repeat(32), text: 'forged' },
      ip: GUEST_IP
    });
    assert.equal(edit.status, 403, `edit via ${peerId}`);
    const removal = await request(fixture.socketPath, 'DELETE', `/api/rooms/${ROOM_ID}/chat/${messageId}`, {
      body: { peerId, sessionToken: 'a'.repeat(32) },
      ip: GUEST_IP
    });
    assert.equal(removal.status, 403, `delete via ${peerId}`);
  }
  assert.equal(fixture.store.messages[0].text, 'original');
  assert.equal(fixture.store.messages[0].deleted, undefined);

  const ownEdit = await request(fixture.socketPath, 'PATCH', `/api/rooms/${ROOM_ID}/chat/${messageId}`, {
    body: { text: 'edited by author' },
    cookie: VICTIM_COOKIE,
    ip: VICTIM_IP
  });
  assert.equal(ownEdit.status, 200);
  assert.equal(fixture.store.messages[0].text, 'edited by author');
});

test('a signed-in writer cannot file a message under a peer id they do not hold', async (t) => {
  const fixture = await startServer(t);
  const posted = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/chat`, {
    body: { peerId: 'someone-elses-peer', text: 'hello' },
    cookie: VICTIM_COOKIE,
    ip: VICTIM_IP
  });
  assert.equal(posted.status, 201);
  assert.equal(fixture.store.messages[0].peerId, `auth-${VICTIM_ID}`);
});

test('a banned visitor can no longer read the room chat or roster', async (t) => {
  const fixture = await startServer(t);
  fixture.store.bans.push({ roomId: ROOM_ID, userId: null, ip: BANNED_IP });
  fixture.store.bans.push({ roomId: ROOM_ID, userId: VICTIM_ID, ip: '' });

  for (const pathname of [`/api/rooms/${ROOM_ID}/chat`, `/api/rooms/${ROOM_ID}/peers`]) {
    const byIp = await request(fixture.socketPath, 'GET', pathname, { ip: BANNED_IP });
    assert.equal(byIp.status, 403, pathname);
    assert.equal(byIp.body.code, 'room_banned');
    const byAccount = await request(fixture.socketPath, 'GET', pathname, { cookie: VICTIM_COOKIE, ip: VICTIM_IP });
    assert.equal(byAccount.status, 403, pathname);
    const allowed = await request(fixture.socketPath, 'GET', pathname, { ip: GUEST_IP });
    assert.equal(allowed.status, 200, pathname);
  }
});

test('LiveKit admission is only issued to a peer the room roster knows', async (t) => {
  const fixture = await startServer(t);
  const token = (peerId, sessionToken = 'g'.repeat(32)) => request(fixture.socketPath, 'POST', '/api/livekit-token', {
    body: { roomId: ROOM_ID, peerId, sessionToken, name: 'Guest' },
    ip: GUEST_IP
  });

  const ghost = await token('ghost-listener');
  assert.equal(ghost.status, 409);
  assert.equal(ghost.body.code, 'not_in_room');
  assert.equal((await token(`auth-${VICTIM_ID}`)).status, 400);
  assert.equal(fixture.issued.length, 0);

  const guest = fixture.open('', GUEST_IP);
  await guest.ready;
  await joinVoiceRoom(guest, { roomId: ROOM_ID, peerId: 'guest-peer', sessionToken: 'g'.repeat(32), name: 'Guest' });
  assert.equal((await token('guest-peer', 'x'.repeat(32))).status, 403);
  const admitted = await token('guest-peer');
  assert.equal(admitted.status, 200);
  assert.equal(fixture.issued.length, 1);
});

test('a join that is still in flight when the token request lands is waited for', async (t) => {
  const fixture = await startServer(t);
  const guest = fixture.open('', GUEST_IP);
  await guest.ready;
  sendWs(guest.ws, 'room.join', { roomId: ROOM_ID, peerId: 'racing-peer', sessionToken: 'r'.repeat(32), name: 'Racer' });
  const admitted = await request(fixture.socketPath, 'POST', '/api/livekit-token', {
    body: { roomId: ROOM_ID, peerId: 'racing-peer', sessionToken: 'r'.repeat(32), name: 'Racer' },
    ip: GUEST_IP
  });
  assert.equal(admitted.status, 200);
});

test('cookie writes and WebSocket handshakes from another origin are refused on every route', async (t) => {
  const fixture = await startServer(t);
  const evil = { Origin: 'https://livekit.localhost' };

  const legacy = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/kick`, {
    body: { peerId: 'anyone' }, cookie: OWNER_COOKIE, ip: OWNER_IP, headers: evil
  });
  assert.equal(legacy.status, 403);
  assert.equal(legacy.body.error, 'Cross-origin request rejected');
  // Domain routes and even unknown paths go through the same hook.
  const domain = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/bans`, {
    body: { peerId: 'anyone' }, cookie: OWNER_COOKIE, ip: OWNER_IP, headers: evil
  });
  assert.equal(domain.status, 403);
  assert.equal(domain.body.error, 'Cross-origin request rejected');

  const sameOrigin = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/kick`, {
    body: { peerId: 'anyone' }, cookie: OWNER_COOKIE, ip: OWNER_IP, headers: { Origin: 'http://localhost' }
  });
  assert.equal(sameOrigin.status, 404);
  // Without a cookie there is nothing to ride on, and reads are never blocked.
  const anonymous = await request(fixture.socketPath, 'POST', '/api/rooms/nope/chat', { body: {}, headers: evil });
  assert.notEqual(anonymous.body?.error, 'Cross-origin request rejected');

  const hijack = fixture.open(VICTIM_COOKIE, VICTIM_IP, evil);
  await assert.rejects(hijack.ready, /Unexpected server response: 403/);
  const legit = fixture.open(VICTIM_COOKIE, VICTIM_IP, { Origin: 'http://localhost' });
  await legit.ready;
});

test('failed logins are capped per account no matter how many addresses try', async (t) => {
  const fixture = await startServer(t);
  const attempt = (i) => request(fixture.socketPath, 'POST', '/api/auth/login', {
    body: { login: 'victim', password: `guess-${i}` },
    ip: `203.0.113.${i + 1}`
  });
  for (let i = 0; i < 3; i += 1) assert.equal((await attempt(i)).status, 401);
  const blocked = await attempt(3);
  assert.equal(blocked.status, 429);
  const otherAccount = await request(fixture.socketPath, 'POST', '/api/auth/login', {
    body: { login: 'someone-else', password: 'guess' },
    ip: '203.0.113.200'
  });
  assert.equal(otherAccount.status, 401);
});

test('a server mute revokes the admissions issued before it', async (t) => {
  mockLiveKitAdmin(t);
  const fixture = await startServer(t);
  const owner = fixture.open(OWNER_COOKIE, OWNER_IP);
  const victim = fixture.open(VICTIM_COOKIE, VICTIM_IP);
  await Promise.all([owner.ready, victim.ready]);
  await joinVoiceRoom(owner, { roomId: ROOM_ID, peerId: 'owner-peer', sessionToken: 'o'.repeat(32), name: 'Owner' });
  await joinVoiceRoom(victim, { roomId: ROOM_ID, peerId: 'victim-peer', sessionToken: 'v'.repeat(32), name: 'Victim' });

  const mute = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/server-mute`, {
    body: { peerId: 'victim-peer', muted: true },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(mute.status, 200, JSON.stringify(mute.body));
  assert.deepEqual(fixture.store.revokedPrincipals, [{ roomId: ROOM_ID, principalId: VICTIM_ID, principalType: 'account' }]);

  const unmute = await request(fixture.socketPath, 'POST', `/api/rooms/${ROOM_ID}/server-mute`, {
    body: { peerId: 'victim-peer', muted: false },
    cookie: OWNER_COOKIE,
    ip: OWNER_IP
  });
  assert.equal(unmute.status, 200);
  assert.equal(fixture.store.revokedPrincipals.length, 1);
});
