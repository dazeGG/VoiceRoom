process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_URL = 'ws://livekit:7880';
process.env.LIVEKIT_GATE_PUBLIC_URL = 'ws://gate.example.test';
process.env.LIVEKIT_GATE_SECRET = 'test-g05-livekit-gate-secret-32-bytes-minimum';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'devsecret';

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { GatePrincipal } from '../src/domains/admission/credential-boundary.service.ts';
import type { GateClaims } from '../src/domains/admission/gate-credential-signer.ts';
import type { Fakes } from './fakes/index.ts';

const { createApiApp } = await import('../src/server.ts');
const { createGateCredentialSigner } = await import('../src/domains/admission/gate-credential-signer.ts');
const { createLiveKitAuthGateService, extractCredential } =
  await import('../src/domains/admission/livekit-auth-gate.service.ts');

const ROOT = path.resolve(import.meta.dirname, '../../..');
const PEER_ID = 'peer-g05a';

// The gate only reads the JWT payload (LiveKit verifies the signature), so the
// socket proofs can hand it an unsigned token with the right claims.
function unsignedLiveKitJwt({
  sub,
  room,
  nbf = Math.floor(Date.now() / 1000)
}: {
  sub: string;
  room: string;
  nbf?: number;
}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub, nbf, video: { room } })}.signature`;
}
const SESSION_TOKEN = 'session-g05-token-0000000000000001';

// The refusal code of a check, or undefined when it passed.
function codeOf(result: { ok: true } | { ok: false; code: string }) {
  return result.ok ? undefined : result.code;
}

type PeerRow = { id: string; gateGuestPrincipalId: string; [key: string]: unknown };
type CredentialRow = {
  peerId: string;
  principal: GatePrincipal;
  principalEpoch: number | undefined;
  revoked: boolean;
  roomId: string;
};

function isPrincipal(value: unknown): value is GatePrincipal {
  const principal = value as Partial<GatePrincipal> | null;
  return (
    (principal?.principalType === 'account' || principal?.principalType === 'guest') &&
    typeof principal.principalId === 'string' &&
    principal.principalId.trim().length > 0
  );
}

type GateAwareStore = Fakes['store'] & {
  revoked: Array<{ roomId: string; peerId: string; principal: GatePrincipal }>;
  failNextBanTransaction(): void;
  clearPeerGateGuestPrincipalId(peerId?: string): void;
};

function createGateAwareStore() {
  const credentials = new Map<string, CredentialRow>();
  const epochs = new Map<string, number>();
  const revoked: Array<{ roomId: string; peerId: string; principal: GatePrincipal }> = [];
  const room = {
    createdAt: Date.now(),
    creatorIp: '127.0.0.1',
    emptySince: Date.now(),
    id: 'room-g05',
    isStatic: true,
    name: 'G05',
    ownerId: 'owner-1',
    peers: new Map<string, PeerRow>(),
    updatedAt: Date.now()
  };
  const rooms = new Map<string, typeof room>();
  room.peers.set(PEER_ID, {
    accountUserId: '',
    gateGuestPrincipalId: `guest-id-${PEER_ID}`,
    id: PEER_ID,
    ip: '203.0.113.10',
    sessionToken: SESSION_TOKEN,
    transport: {
      close() {},
      id: 'transport-g05',
      send() {
        return true;
      }
    }
  });
  room.peers.set('peer-same-nat', {
    accountUserId: 'account-same-nat',
    gateGuestPrincipalId: '',
    id: 'peer-same-nat',
    ip: '203.0.113.10',
    sessionToken: 'session-same-nat',
    transport: {
      close() {},
      id: 'transport-same-nat',
      send() {
        return true;
      }
    }
  });
  rooms.set('room-g05', room);
  let failBanTransaction = false;
  function principalKey({
    roomId,
    principalType,
    principalId
  }: {
    roomId: string;
    principalType: string;
    principalId: string;
  }) {
    return `${roomId}:${principalType}:${principalId}`;
  }
  function normalizePrincipal({
    accountUserId,
    guestPrincipalId,
    roomId
  }: { accountUserId?: string | null; guestPrincipalId?: string; roomId?: string } = {}): GatePrincipal | null {
    if (accountUserId) return { principalType: 'account', principalId: accountUserId };
    const guest = (guestPrincipalId || '').trim();
    if (!roomId || !guest) return null;
    return { principalType: 'guest', principalId: `${roomId}:${guest}` };
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
    normalizeGatePrincipal: normalizePrincipal,
    async isRoomServerMuted() {
      return false;
    },
    async getLiveKitGatePrincipalEpoch({ principal, roomId = '' } = {}) {
      assert.ok(principal);
      const key = principalKey({ roomId, ...principal });
      if (!epochs.has(key)) epochs.set(key, 0);
      return { status: 'ready', epoch: epochs.get(key) };
    },
    async createLiveKitGateCredential({
      credentialHash = '',
      peerId = '',
      principal,
      principalEpoch,
      roomId = ''
    } = {}) {
      assert.ok(principal);
      const key = principalKey({ roomId, ...principal });
      if ((epochs.get(key) || 0) !== principalEpoch) return { status: 'epoch_mismatch', credential: null };
      credentials.set(credentialHash, { peerId, principal, principalEpoch, revoked: false, roomId });
      return { status: 'created', credential: { id: 'cred-1' } };
    },
    async verifyLiveKitGateCredential({
      credentialHash = '',
      peerId,
      principalEpoch,
      principalId = '',
      principalType = '',
      roomId = ''
    } = {}) {
      const row = credentials.get(credentialHash);
      const key = principalKey({ roomId, principalType, principalId });
      return {
        status:
          row &&
          !row.revoked &&
          row.roomId === roomId &&
          row.peerId === peerId &&
          row.principal.principalType === principalType &&
          row.principal.principalId === principalId &&
          row.principalEpoch === principalEpoch &&
          epochs.get(key) === principalEpoch
            ? 'allowed'
            : 'denied'
      };
    },
    async revokeLiveKitGatePeer({ roomId = '', peerId = '', accountUserId, guestPrincipalId } = {}) {
      const principal = normalizePrincipal({ accountUserId, guestPrincipalId, roomId });
      assert.ok(principal);
      const key = principalKey({ roomId, ...principal });
      epochs.set(key, (epochs.get(key) || 0) + 1);
      for (const row of credentials.values()) {
        if (
          row.roomId === roomId &&
          row.principal.principalType === principal.principalType &&
          row.principal.principalId === principal.principalId
        ) {
          row.revoked = true;
        }
      }
      revoked.push({ roomId, peerId, principal });
      return { status: 'revoked', epoch: epochs.get(key) };
    },
    async createRoomBan() {
      throw new Error('legacy createRoomBan fallback must not be used for LiveKit gate bans');
    },
    async createRoomBanWithLiveKitGateRevocations({ roomId = '', ip, principals } = {}) {
      if (failBanTransaction) throw new Error('simulated ban transaction failure');
      if (!Array.isArray(principals) || principals.length === 0 || !principals.every(isPrincipal)) {
        return { status: 'invalid', ban: null, revocations: [] };
      }
      for (const principal of principals) {
        const key = principalKey({ roomId, ...principal });
        epochs.set(key, (epochs.get(key) || 0) + 1);
        for (const row of credentials.values()) {
          if (
            row.roomId === roomId &&
            row.principal.principalType === principal.principalType &&
            row.principal.principalId === principal.principalId
          ) {
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
    async markRoomActive() {
      return null;
    },
    async markRoomEmpty() {
      return null;
    },
    async pruneRooms() {
      return false;
    },
    async assertLiveKitGateReady() {
      return true;
    }
  } satisfies GateAwareStore;
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
  const body = response.json<{ ok: boolean; room: string; token: string; url: string }>();
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
  assert.equal(
    (
      await store.verifyLiveKitGateCredential({
        credentialHash: signer.hash(gateCredential),
        peerId: verified.claims.peer,
        principalEpoch: verified.claims.pEpoch,
        principalId: verified.claims.pId,
        principalType: verified.claims.pType,
        roomId: verified.claims.room
      })
    ).status,
    'allowed'
  );
});

test('G05 signer validates finite time claims and expires credentials', () => {
  let now = 1_000;
  const signer = createGateCredentialSigner({
    secret: process.env.LIVEKIT_GATE_SECRET,
    now: () => now
  });
  assert.throws(
    () =>
      signer.sign({
        expiresAt: Number.POSITIVE_INFINITY,
        peerId: PEER_ID,
        principalEpoch: 0,
        principalId: `room-g05:guest-id-${PEER_ID}`,
        principalType: 'guest',
        roomId: 'room-g05'
      }),
    /Invalid gate credential/
  );
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
  assert.equal(codeOf(signer.verify(credential)), 'expired');
});

test('G05-A01 same gate credential is denied after epoch revoke', async () => {
  const store = createGateAwareStore();
  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const principal: GatePrincipal = { principalType: 'guest', principalId: `room-g05:guest-id-${PEER_ID}` };
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
  assert.equal(codeOf(denied), 'denied');
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
  assert.match(
    compose,
    /command:\s*\["node",\s*"apps\/api\/src\/domains\/admission\/livekit-auth-gate\.service\.ts"\]/
  );
  assert.match(compose, /LIVEKIT_URL:\s*\$\{LIVEKIT_URL:-ws:\/\/livekit:7880\}/);
  assert.match(apiService, /LIVEKIT_INTERNAL_URL:\s*ws:\/\/livekit:7880/);
  assert.doesNotMatch(apiService, /LIVEKIT_INTERNAL_URL:\s*\$\{LIVEKIT_URL\b/);
  assert.doesNotMatch(apiService, /LIVEKIT_INTERNAL_URL:\s*\$\{LIVEKIT_GATE_PUBLIC_URL\b/);
  assert.match(
    compose,
    /LIVEKIT_GATE_PUBLIC_URL:\s*\$\{LIVEKIT_GATE_PUBLIC_URL:-wss:\/\/\$\{LIVEKIT_DOMAIN:-livekit\.\$\{DOMAIN\}\}\}/
  );
  assert.match(compose, /LIVEKIT_GATE_SECRET/);
  assert.doesNotMatch(compose, /"7880:7880"/);
  assert.match(caddy, /reverse_proxy livekit-gate:3080/);
  assert.doesNotMatch(caddy, /reverse_proxy livekit:7880/);
  assert.match(lkv, /livekit-gate:/);
  assert.match(lkv, /postgres:/);
  assert.match(lkv, /target:\s*api/);
  assert.match(lkv, /apps\/api\/src\/domains\/admission\/livekit-auth-gate\.service\.ts/);
  assert.doesNotMatch(lkv, /"7880:7880"/);
});

test('development topology routes public signaling through the auth gate', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.dev.yml'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const apiService = compose.match(/\n  api:\n[\s\S]*?(?=\n  [a-z][\w-]*:\n)/)?.[0] || '';
  const livekitService = compose.match(/\n  livekit:\n[\s\S]*?(?=\n  [a-z][\w-]*:\n)/)?.[0] || '';
  const gateService = compose.match(/\n  livekit-gate:\n[\s\S]*?(?=\n  [a-z][\w-]*:\n|\nvolumes:)/)?.[0] || '';

  assert.match(apiService, /LIVEKIT_INTERNAL_URL:\s*ws:\/\/livekit:7880/);
  assert.match(apiService, /LIVEKIT_GATE_PUBLIC_URL:\s*\$\{LIVEKIT_PUBLIC_URL:-ws:\/\/localhost:7880\}/);
  assert.match(apiService, /LIVEKIT_GATE_SECRET:/);
  assert.match(apiService, /livekit-gate:\s*\n\s+condition: service_started/);
  assert.doesNotMatch(livekitService, /\$\{LIVEKIT_HTTP_PORT:-7880\}:7880/);
  assert.match(gateService, /livekit-auth-gate\.service\.ts/);
  assert.match(gateService, /\$\{LIVEKIT_HTTP_PORT:-7880\}:3080/);
  assert.equal(packageJson.scripts['dev:livekit'], 'docker compose -f docker-compose.dev.yml up --build livekit-gate');
  assert.equal(
    packageJson.scripts['dev:restart'],
    'docker compose -f docker-compose.dev.yml restart livekit-gate api web'
  );
});

test('G05-A03..A06 amended strict proof is green and fail-on-blocked exits zero', async () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/lkv/run-auth-gate-proof.mts'), '--json', '--fail-on-blocked'],
    {
      cwd: ROOT,
      encoding: 'utf8'
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout) as {
    status: string;
    selectedMechanism: string;
    greenF11Allowed: boolean;
    successorStartAllowed: boolean;
    cases: Array<{ id: string; denied?: boolean; allowed?: boolean; sharedNatAllowed?: boolean }>;
    topology: { internalLiveKitDefaultOk: boolean; productionGateCommandOk: boolean };
  };
  assert.equal(proof.status, 'STRICT_BOUNDARY_PROVEN');
  assert.equal(proof.selectedMechanism, 'external-auth-gate');
  assert.equal(proof.greenF11Allowed, true);
  assert.equal(proof.successorStartAllowed, true);
  for (const id of [
    'G05-A01-same-token-after-revoke',
    'G05-A03-db-outage',
    'G05-A05-missing-credential',
    'G05-A06-account-vs-guest-nat'
  ]) {
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
  assert.equal(codeOf(await gate.authorize('/rtc')), 'malformed');
});

test('G05 gate rejects wss upstreams because upstream proxying is raw TCP only', () => {
  assert.throws(
    () =>
      createLiveKitAuthGateService({
        roomStore: createGateAwareStore(),
        secret: process.env.LIVEKIT_GATE_SECRET,
        upstreamUrl: 'wss://livekit.example.test/rtc'
      }),
    /must be ws:\/\/ because the auth gate uses a raw TCP upstream/
  );
});

test('G05 gate survives a client cancellation followed by an upstream socket error', async (t) => {
  class FakeSocket extends EventEmitter {
    destroyed = false;
    writable = true;
    writableEnded = false;
    writes: unknown[] = [];

    write(value: unknown) {
      if (this.destroyed || this.writableEnded) {
        this.emit('error', Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' }));
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

    pipe<T>(target: T): T {
      return target;
    }
  }

  const upstream = new FakeSocket();
  t.mock.method(net, 'connect', () => upstream);
  const claims: GateClaims = {
    cid: 'credential',
    exp: Date.now() + 60_000,
    iat: Date.now(),
    peer: PEER_ID,
    pEpoch: 0,
    pId: `room-g05:guest-id-${PEER_ID}`,
    pType: 'guest',
    room: 'room-g05'
  };
  const gate = createLiveKitAuthGateService({
    boundary: {
      assertReady: async () => true as const,
      authorizeCredential: async () => ({ ok: true as const, claims })
    },
    roomStore: {},
    upstreamUrl: 'ws://livekit:7880'
  });
  const server = gate.createServer();
  t.after(() => server.close());
  const client = new FakeSocket();
  const accessToken = unsignedLiveKitJwt({ sub: PEER_ID, room: 'voice-room-room-g05' });

  server.emit(
    'upgrade',
    { url: `/rtc?access_token=${accessToken}&vr_gate_credential=test`, headers: {} },
    client,
    Buffer.alloc(0)
  );
  await new Promise((resolve) => setImmediate(resolve));
  upstream.emit('connect');
  client.destroy();
  const error = Object.assign(new Error('peer closed'), { code: 'EPIPE' });

  assert.doesNotThrow(() => upstream.emit('error', error));
  assert.equal(client.destroyed, true);
});

test('G05 ban reports no success when ban+gate revocation transaction fails', async (t) => {
  const store = createGateAwareStore();
  const signer = createGateCredentialSigner({ secret: process.env.LIVEKIT_GATE_SECRET });
  const principal: GatePrincipal = { principalType: 'guest', principalId: `room-g05:guest-id-${PEER_ID}` };
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
      async getSessionUser(token: string) {
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
  assert.equal(
    (
      await store.verifyLiveKitGateCredential({
        credentialHash: signer.hash(credential),
        peerId: PEER_ID,
        principalEpoch: 0,
        principalId: principal.principalId,
        principalType: principal.principalType,
        roomId: 'room-g05'
      })
    ).status,
    'allowed'
  );
  assert.deepEqual(store.revoked, []);
});

test('G05 ban fails closed when transactional gate revoke helper is unavailable', async (t) => {
  const store = createGateAwareStore();
  Reflect.deleteProperty(store, 'createRoomBanWithLiveKitGateRevocations');
  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token: string) {
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
  assert.equal(response.json<{ code?: string }>().code, 'livekit_gate_revoke_unavailable');
  assert.deepEqual(store.revoked, []);
});

test('G05 ban fails closed before writing when a targeted guest has no gate principal', async (t) => {
  const store = createGateAwareStore();
  store.clearPeerGateGuestPrincipalId();
  const app = createApiApp({
    store,
    users: {
      async getSessionUser(token: string) {
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
  assert.equal(response.json<{ code?: string }>().code, 'livekit_gate_principal_missing');
  assert.deepEqual(store.revoked, []);
});
