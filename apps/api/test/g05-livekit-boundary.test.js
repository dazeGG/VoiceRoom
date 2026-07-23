'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_URL = 'ws://livekit:7880';
process.env.LIVEKIT_GATE_PUBLIC_URL = 'ws://gate.example.test';
process.env.LIVEKIT_GATE_SECRET = 'test-g05-livekit-gate-secret-32-bytes-minimum';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'devsecret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createApiApp } = require('../src/server');
const { createGateCredentialSigner } = require('../src/domains/admission/gate-credential-signer');
const { createLiveKitAuthGateService, extractCredential } = require('../src/domains/admission/livekit-auth-gate-service');

const ROOT = path.resolve(__dirname, '../../..');
const PEER_ID = 'peer-g05a';
const SESSION_TOKEN = 'session-g05-token-0000000000000001';

function createGateAwareStore() {
  const rooms = new Map();
  const credentials = new Map();
  const epochs = new Map();
  const revoked = [];
  const room = {
    createdAt: Date.now(),
    creatorIp: '127.0.0.1',
    emptySince: Date.now(),
    id: 'room-g05',
    isStatic: true,
    name: 'G05',
    ownerId: 'owner-1',
    peers: new Map(),
    updatedAt: Date.now()
  };
  room.peers.set(PEER_ID, {
    accountUserId: '',
    gateGuestPrincipalId: `guest-id-${PEER_ID}`,
    id: PEER_ID,
    ip: '203.0.113.10',
    sessionToken: SESSION_TOKEN,
    transport: { close() {}, id: 'transport-g05', send() { return true; } }
  });
  room.peers.set('peer-same-nat', {
    accountUserId: 'account-same-nat',
    gateGuestPrincipalId: '',
    id: 'peer-same-nat',
    ip: '203.0.113.10',
    sessionToken: 'session-same-nat',
    transport: { close() {}, id: 'transport-same-nat', send() { return true; } }
  });
  rooms.set('room-g05', room);
  let failBanTransaction = false;
  function principalKey({ roomId, principalType, principalId }) {
    return `${roomId}:${principalType}:${principalId}`;
  }
  return {
    revoked,
    async countRooms() {
      return rooms.size;
    },
    async createRoom() {
      throw new Error('not used');
    },
    async createRoomWithQuota() {
      throw new Error('not used');
    },
    async getRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? { ...room, peers: room.peers } : null;
    },
    async getOrCreatePeerIdentity({ peerId, sessionToken }) {
      if (sessionToken === 'bad-session') return { status: 'token_mismatch', identity: null };
      return { status: 'created', identity: { id: `guest-id-${peerId}`, avatarColorKey: 'blurple', peerId } };
    },
    normalizeGatePrincipal({ accountUserId, guestPrincipalId, roomId }) {
      if (accountUserId) return { principalType: 'account', principalId: accountUserId };
      const guest = String(guestPrincipalId || '').trim();
      if (!roomId || !guest) return null;
      return { principalType: 'guest', principalId: `${roomId}:${guest}` };
    },
    async getLiveKitGatePrincipalEpoch({ principal, roomId }) {
      const key = principalKey({ roomId, ...principal });
      if (!epochs.has(key)) epochs.set(key, 0);
      return { status: 'ready', epoch: epochs.get(key) };
    },
    async createLiveKitGateCredential({ credentialHash, peerId, principal, principalEpoch, roomId }) {
      const key = principalKey({ roomId, ...principal });
      if ((epochs.get(key) || 0) !== principalEpoch) return { status: 'epoch_mismatch', credential: null };
      credentials.set(credentialHash, { peerId, principal, principalEpoch, revoked: false, roomId });
      return { status: 'created', credential: { id: 'cred-1' } };
    },
    async verifyLiveKitGateCredential({ credentialHash, peerId, principalEpoch, principalId, principalType, roomId }) {
      const row = credentials.get(credentialHash);
      const key = principalKey({ roomId, principalType, principalId });
      return {
        status: row
          && !row.revoked
          && row.roomId === roomId
          && row.peerId === peerId
          && row.principal.principalType === principalType
          && row.principal.principalId === principalId
          && row.principalEpoch === principalEpoch
          && epochs.get(key) === principalEpoch
          ? 'allowed'
          : 'denied'
      };
    },
    async revokeLiveKitGatePeer({ roomId, peerId, accountUserId, guestPrincipalId }) {
      const principal = this.normalizeGatePrincipal({ accountUserId, guestPrincipalId, roomId });
      const key = principalKey({ roomId, ...principal });
      epochs.set(key, (epochs.get(key) || 0) + 1);
      for (const row of credentials.values()) {
        if (row.roomId === roomId && row.principal.principalType === principal.principalType && row.principal.principalId === principal.principalId) {
          row.revoked = true;
        }
      }
      revoked.push({ roomId, peerId, principal });
      return { status: 'revoked', epoch: epochs.get(key) };
    },
    async createRoomBan() {
      throw new Error('legacy createRoomBan fallback must not be used for LiveKit gate bans');
    },
    async createRoomBanWithLiveKitGateRevocations({ roomId, ip, principals }) {
      if (failBanTransaction) throw new Error('simulated ban transaction failure');
      if (!Array.isArray(principals) || principals.length === 0 || principals.some((principal) => {
        return (principal?.principalType !== 'account' && principal?.principalType !== 'guest')
          || typeof principal.principalId !== 'string'
          || principal.principalId.trim().length === 0;
      })) {
        return { status: 'invalid', ban: null, revocations: [] };
      }
      for (const principal of principals) {
        const key = principalKey({ roomId, ...principal });
        epochs.set(key, (epochs.get(key) || 0) + 1);
        for (const row of credentials.values()) {
          if (row.roomId === roomId && row.principal.principalType === principal.principalType && row.principal.principalId === principal.principalId) {
            row.revoked = true;
          }
        }
        revoked.push({ roomId, peerId: '', principal });
      }
      return { status: 'created', ban: { id: 'ban-1', ip, roomId }, revocations: revoked };
    },
    failNextBanTransaction() {
      failBanTransaction = true;
    },
    clearPeerGateGuestPrincipalId(peerId = PEER_ID) {
      const peer = room.peers.get(peerId);
      if (peer) peer.gateGuestPrincipalId = '';
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {},
    async assertLiveKitGateReady() {
      return true;
    }
  };
}

test('G05-A01 API mints LiveKit JWT plus separate exact gate credential', async (t) => {
  const store = createGateAwareStore();
  const app = createApiApp({ store });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/livekit-token',
    payload: {
      name: 'Guest',
      peerId: PEER_ID,
      roomId: 'room-g05',
      sessionToken: SESSION_TOKEN
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.room, 'voice-room-room-g05');
  assert.match(body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(body.url, /^ws:\/\/gate\.example\.test\/\?/);
  const gateCredential = new URL(body.url).searchParams.get('vr_gate_credential');
  assert.ok(gateCredential);

  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const verified = signer.verify(gateCredential);
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.room, 'room-g05');
  assert.equal(verified.claims.peer, PEER_ID);
  assert.equal(verified.claims.pType, 'guest');
  assert.equal(verified.claims.pId, `room-g05:guest-id-${PEER_ID}`);
  assert.equal((await store.verifyLiveKitGateCredential({
    credentialHash: signer.hash(gateCredential),
    peerId: verified.claims.peer,
    principalEpoch: verified.claims.pEpoch,
    principalId: verified.claims.pId,
    principalType: verified.claims.pType,
    roomId: verified.claims.room
  })).status, 'allowed');
});

test('G05 signer validates finite time claims and expires credentials', () => {
  let now = 1_000;
  const signer = createGateCredentialSigner({
    secret: process.env.LIVEKIT_GATE_SECRET,
    now: () => now
  });
  assert.throws(() => signer.sign({
    expiresAt: Number.POSITIVE_INFINITY,
    peerId: PEER_ID,
    principalEpoch: 0,
    principalId: `room-g05:guest-id-${PEER_ID}`,
    principalType: 'guest',
    roomId: 'room-g05'
  }), /Invalid gate credential/);
  const credential = signer.sign({
    expiresAt: 2_000,
    issuedAt: 1_000,
    peerId: PEER_ID,
    principalEpoch: 0,
    principalId: `room-g05:guest-id-${PEER_ID}`,
    principalType: 'guest',
    roomId: 'room-g05'
  });
  assert.equal(signer.verify(credential).ok, true);
  now = 2_000;
  assert.equal(signer.verify(credential).code, 'expired');
});

test('G05-A01 same gate credential is denied after epoch revoke', async () => {
  const store = createGateAwareStore();
  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const principal = { principalType: 'guest', principalId: `room-g05:guest-id-${PEER_ID}` };
  const credential = signer.sign({
    expiresAt: Date.now() + 600000,
    peerId: PEER_ID,
    principalEpoch: 0,
    principalId: principal.principalId,
    principalType: principal.principalType,
    roomId: 'room-g05'
  });
  await store.getLiveKitGatePrincipalEpoch({ principal, roomId: 'room-g05' });
  await store.createLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId: PEER_ID,
    principal,
    principalEpoch: 0,
    roomId: 'room-g05'
  });
  const gate = createLiveKitAuthGateService({
    roomStore: store,
    secret: process.env.LIVEKIT_GATE_SECRET,
    upstreamUrl: 'ws://livekit:7880'
  });
  assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(credential)}`)).ok, true);
  await store.revokeLiveKitGatePeer({ roomId: 'room-g05', peerId: PEER_ID, guestPrincipalId: `guest-id-${PEER_ID}` });
  const denied = await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(credential)}`);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'denied');
});

test('G05-A02 topology exposes only the gate as public signaling boundary', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const apiService = compose.match(/\n  api:\n[\s\S]*?(?=\n  [a-z][\w-]*:\n)/)?.[0] || '';
  const lkv = fs.readFileSync(path.join(ROOT, 'docker-compose.lkv.yml'), 'utf8');
  const caddy = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/livekit/external-auth-gate.v1.json'), 'utf8'));

  assert.equal(config.publicSignaling.fallbackAllowed, false);
  assert.equal(config.internalLiveKit.productionHostBindAllowed, false);
  assert.match(compose, /livekit-gate:/);
  assert.match(compose, /command:\s*\["node",\s*"apps\/api\/src\/domains\/admission\/livekit-auth-gate-service\.js"\]/);
  assert.match(compose, /LIVEKIT_URL:\s*\$\{LIVEKIT_URL:-ws:\/\/livekit:7880\}/);
  assert.match(apiService, /LIVEKIT_INTERNAL_URL:\s*ws:\/\/livekit:7880/);
  assert.doesNotMatch(apiService, /LIVEKIT_INTERNAL_URL:\s*\$\{LIVEKIT_URL\b/);
  assert.doesNotMatch(apiService, /LIVEKIT_INTERNAL_URL:\s*\$\{LIVEKIT_GATE_PUBLIC_URL\b/);
  assert.match(compose, /LIVEKIT_GATE_PUBLIC_URL:\s*\$\{LIVEKIT_GATE_PUBLIC_URL:-wss:\/\/\$\{LIVEKIT_DOMAIN:-livekit\.\$\{DOMAIN\}\}\}/);
  assert.match(compose, /LIVEKIT_GATE_SECRET/);
  assert.doesNotMatch(compose, /"7880:7880"/);
  assert.match(caddy, /reverse_proxy livekit-gate:3080/);
  assert.doesNotMatch(caddy, /reverse_proxy livekit:7880/);
  assert.match(lkv, /livekit-gate:/);
  assert.match(lkv, /postgres:/);
  assert.match(lkv, /target:\s*api/);
  assert.match(lkv, /apps\/api\/src\/domains\/admission\/livekit-auth-gate-service\.js/);
  assert.doesNotMatch(lkv, /"7880:7880"/);
});

test('G05-A03..A06 amended strict proof is green and fail-on-blocked exits zero', async () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lkv/run-auth-gate-proof.mjs'), '--json', '--fail-on-blocked'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.status, 'STRICT_BOUNDARY_PROVEN');
  assert.equal(proof.selectedMechanism, 'external-auth-gate');
  assert.equal(proof.greenF11Allowed, true);
  assert.equal(proof.successorStartAllowed, true);
  for (const id of ['G05-A01-same-token-after-revoke', 'G05-A03-db-outage', 'G05-A05-missing-credential', 'G05-A06-account-vs-guest-nat']) {
    const entry = proof.cases.find((item) => item.id === id);
    assert.ok(entry, `missing ${id}`);
    assert.notEqual(entry.denied, false, id);
    assert.notEqual(entry.allowed, false, id);
    assert.notEqual(entry.sharedNatAllowed, false, id);
  }
  assert.equal(proof.topology.internalLiveKitDefaultOk, true);
  assert.equal(proof.topology.productionGateCommandOk, true);
});

test('G05 gate strips credential before upstream and fails closed on malformed credentials', async () => {
  const stripped = extractCredential('/rtc?access_token=lk&vr_gate_credential=secret&room=voice-room-room-g05');
  assert.equal(stripped.credential, 'secret');
  assert.equal(stripped.strippedPath, '/rtc?access_token=lk&room=voice-room-room-g05');

  const store = createGateAwareStore();
  const gate = createLiveKitAuthGateService({
    roomStore: store,
    secret: process.env.LIVEKIT_GATE_SECRET,
    upstreamUrl: 'ws://livekit:7880'
  });
  const denied = await gate.authorize('/rtc');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'malformed');
});

test('G05 gate rejects wss upstreams because upstream proxying is raw TCP only', () => {
  assert.throws(() => createLiveKitAuthGateService({
    roomStore: createGateAwareStore(),
    secret: process.env.LIVEKIT_GATE_SECRET,
    upstreamUrl: 'wss://livekit.example.test/rtc'
  }), /must be ws:\/\/ because the auth gate uses a raw TCP upstream/);
});

test('G05 gate survives a client cancellation followed by an upstream socket error', async (t) => {
  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.writable = true;
      this.writableEnded = false;
      this.writes = [];
    }

    write(value) {
      if (this.destroyed || this.writableEnded) {
        const error = new Error('write after end');
        error.code = 'ERR_STREAM_WRITE_AFTER_END';
        this.emit('error', error);
        return false;
      }
      this.writes.push(value);
      return true;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.writable = false;
      this.emit('close');
    }

    pipe(target) {
      return target;
    }
  }

  const originalConnect = net.connect;
  t.after(() => {
    net.connect = originalConnect;
  });
  const upstream = new FakeSocket();
  net.connect = () => upstream;
  const gate = createLiveKitAuthGateService({
    boundary: {
      assertReady: async () => true,
      authorizeCredential: async () => ({ ok: true, claims: {} })
    },
    roomStore: {},
    upstreamUrl: 'ws://livekit:7880'
  });
  const server = gate.createServer();
  t.after(() => server.close());
  const client = new FakeSocket();

  server.emit('upgrade', { url: '/rtc?vr_gate_credential=test', headers: {} }, client, Buffer.alloc(0));
  await new Promise((resolve) => setImmediate(resolve));
  upstream.emit('connect');
  client.destroy();
  const error = new Error('peer closed');
  error.code = 'EPIPE';

  assert.doesNotThrow(() => upstream.emit('error', error));
  assert.equal(client.destroyed, true);
});

test('G05 ban reports no success when ban+gate revocation transaction fails', async (t) => {
  const store = createGateAwareStore();
  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const principal = { principalType: 'guest', principalId: `room-g05:guest-id-${PEER_ID}` };
  const credential = signer.sign({
    expiresAt: Date.now() + 600000,
    peerId: PEER_ID,
    principalEpoch: 0,
    principalId: principal.principalId,
    principalType: principal.principalType,
    roomId: 'room-g05'
  });
  await store.getLiveKitGatePrincipalEpoch({ principal, roomId: 'room-g05' });
  await store.createLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId: PEER_ID,
    principal,
    principalEpoch: 0,
    roomId: 'room-g05'
  });
  store.failNextBanTransaction();
  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token) {
        return token === 'owner-session' ? { user: { id: 'owner-1', login: 'owner' } } : null;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/rooms/room-g05/ban',
    headers: { cookie: 'vr_session=owner-session' },
    payload: { peerId: PEER_ID }
  });
  assert.equal(response.statusCode, 500, response.body);
  assert.equal((await store.verifyLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId: PEER_ID,
    principalEpoch: 0,
    principalId: principal.principalId,
    principalType: principal.principalType,
    roomId: 'room-g05'
  })).status, 'allowed');
  assert.deepEqual(store.revoked, []);
});

test('G05 ban fails closed when transactional gate revoke helper is unavailable', async (t) => {
  const store = createGateAwareStore();
  delete store.createRoomBanWithLiveKitGateRevocations;
  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token) {
        return token === 'owner-session' ? { user: { id: 'owner-1', login: 'owner' } } : null;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/rooms/room-g05/ban',
    headers: { cookie: 'vr_session=owner-session' },
    payload: { peerId: PEER_ID }
  });
  assert.equal(response.statusCode, 500, response.body);
  assert.equal(response.json().code, 'livekit_gate_revoke_unavailable');
  assert.deepEqual(store.revoked, []);
});

test('G05 ban fails closed before writing when a targeted guest has no gate principal', async (t) => {
  const store = createGateAwareStore();
  store.clearPeerGateGuestPrincipalId();
  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token) {
        return token === 'owner-session' ? { user: { id: 'owner-1', login: 'owner' } } : null;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/rooms/room-g05/ban',
    headers: { cookie: 'vr_session=owner-session' },
    payload: { peerId: PEER_ID }
  });
  assert.equal(response.statusCode, 500, response.body);
  assert.equal(response.json().code, 'livekit_gate_principal_missing');
  assert.deepEqual(store.revoked, []);
});
