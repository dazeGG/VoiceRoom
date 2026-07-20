'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_URL = 'ws://livekit:7880';
process.env.LIVEKIT_GATE_PUBLIC_URL = 'ws://gate.example.test/rtc';
process.env.LIVEKIT_GATE_SECRET = 'test-g05-livekit-gate-secret-32-bytes-minimum';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'devsecret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { createApiApp } = require('../src/server');
const { createGateCredentialSigner } = require('../src/domains/admission/gate-credential-signer');
const { createLiveKitAuthGateService, extractCredential } = require('../src/domains/admission/livekit-auth-gate-service');

function createGateAwareStore() {
  const rooms = new Map();
  const credentials = new Map();
  const epochs = new Map();
  const revoked = [];
  rooms.set('room-g05', {
    createdAt: Date.now(),
    creatorIp: '127.0.0.1',
    emptySince: Date.now(),
    id: 'room-g05',
    isStatic: false,
    name: 'G05',
    peers: new Map(),
    updatedAt: Date.now()
  });
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
      return { principalType: 'guest', principalId: `${roomId}:${guestPrincipalId}` };
    },
    async getLiveKitGatePrincipalEpoch({ principal, roomId }) {
      const key = principalKey({ roomId, ...principal });
      if (!epochs.has(key)) epochs.set(key, 0);
      return { status: 'ready', epoch: epochs.get(key) };
    },
    async createLiveKitGateCredential({ credentialHash, peerId, principal, principalEpoch, roomId }) {
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
      peerId: 'peer-g05',
      roomId: 'room-g05',
      sessionToken: 'session-g05'
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.room, 'voice-room-room-g05');
  assert.match(body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(body.url, /^ws:\/\/gate\.example\.test\/rtc\?/);
  const gateCredential = new URL(body.url).searchParams.get('vr_gate_credential');
  assert.ok(gateCredential);

  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const verified = signer.verify(gateCredential);
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.room, 'room-g05');
  assert.equal(verified.claims.peer, 'peer-g05');
  assert.equal(verified.claims.pType, 'guest');
  assert.equal(verified.claims.pId, 'room-g05:guest-id-peer-g05');
  assert.equal((await store.verifyLiveKitGateCredential({
    credentialHash: signer.hash(gateCredential),
    peerId: verified.claims.peer,
    principalEpoch: verified.claims.pEpoch,
    principalId: verified.claims.pId,
    principalType: verified.claims.pType,
    roomId: verified.claims.room
  })).status, 'allowed');
});

test('G05-A01 same gate credential is denied after epoch revoke', async () => {
  const store = createGateAwareStore();
  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const principal = { principalType: 'guest', principalId: 'room-g05:guest-id-peer-g05' };
  const credential = signer.sign({
    expiresAt: Date.now() + 600000,
    peerId: 'peer-g05',
    principalEpoch: 0,
    principalId: principal.principalId,
    principalType: principal.principalType,
    roomId: 'room-g05'
  });
  await store.getLiveKitGatePrincipalEpoch({ principal, roomId: 'room-g05' });
  await store.createLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId: 'peer-g05',
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
  await store.revokeLiveKitGatePeer({ roomId: 'room-g05', peerId: 'peer-g05', guestPrincipalId: 'guest-id-peer-g05' });
  const denied = await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(credential)}`);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'denied');
});

test('G05-A02 topology exposes only the gate as public signaling boundary', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const lkv = fs.readFileSync('docker-compose.lkv.yml', 'utf8');
  const caddy = fs.readFileSync('Caddyfile', 'utf8');
  const config = JSON.parse(fs.readFileSync('config/livekit/external-auth-gate.v1.json', 'utf8'));

  assert.equal(config.publicSignaling.fallbackAllowed, false);
  assert.equal(config.internalLiveKit.productionHostBindAllowed, false);
  assert.match(compose, /livekit-gate:/);
  assert.match(compose, /LIVEKIT_GATE_SECRET/);
  assert.doesNotMatch(compose, /"7880:7880"/);
  assert.match(caddy, /reverse_proxy livekit-gate:3080/);
  assert.doesNotMatch(caddy, /reverse_proxy livekit:7880/);
  assert.match(lkv, /livekit-gate:/);
  assert.doesNotMatch(lkv, /"7880:7880"/);
});

test('G05-A03..A06 amended strict proof is green and fail-on-blocked exits zero', async () => {
  const result = spawnSync(process.execPath, ['scripts/lkv/run-auth-gate-proof.mjs', '--json', '--fail-on-blocked'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.status, 'STRICT_BOUNDARY_PROVEN');
  assert.equal(proof.selectedMechanism, 'external-auth-gate');
  assert.equal(proof.greenF11Allowed, true);
  assert.equal(proof.successorStartAllowed, true);
  for (const id of ['G05-A01-same-token-after-revoke', 'G05-A03-db-outage', 'G05-A05-missing-credential', 'G05-A06-account-vs-guest-nat']) {
    assert.ok(proof.cases.some((entry) => entry.id === id), `missing ${id}`);
  }
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
