process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_GATE_SECRET = 'g48-test-livekit-gate-secret-at-least-32-bytes';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Pool } from 'pg';
import { test } from 'node:test';
import type { CredentialProvider } from '../src/domains/admission/admission.service.ts';
import type {
  CredentialIssue,
  GatePrincipal,
  GateRoomStore,
  IssuedCredential
} from '../src/domains/admission/credential-boundary.service.ts';
const { createApiApp } = await import('../src/server.ts');
const { withRosterPeer } = await import('./roster-harness.ts');
const { renderPrometheus, resetMetricsForTest } = await import('../src/lib/metrics.ts');
const { createCredentialBoundaryService } = await import('../src/domains/admission/credential-boundary.service.ts');
const { createLiveKitAuthGateService } = await import('../src/domains/admission/livekit-auth-gate.service.ts');
const { createRoomStore } = await import('../src/lib/room-store.ts');
const { runMigrations } = await import('../src/lib/migrate.ts');
const { createTestDatabase } = await import('./db-harness.ts');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

function listen(server: net.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolve(address.port);
    });
  });
}
function close(server: net.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
// The signed credential of an issue the test expects to succeed.
function credentialOf(issue: CredentialIssue) {
  assert.equal(issue.status, 'issued');
  assert.ok(issue.credential);
  return issue.credential.value;
}
function upgrade(port: number, requestPath: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () =>
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`
      )
    );
    let response = '';
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString();
      if (response.includes('\r\n\r\n')) socket.end();
    });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

test('G48-A04 real credential boundary survives restart, supports multitab, and rejects replay, tamper and ban-during-mint', async () => {
  const rows = new Map<string, Parameters<GateRoomStore['createLiveKitGateCredential']>[0]>();
  const epochs = new Map<string, number>();
  let revokeDuringCreate = false;
  const key = (principal: GatePrincipal, roomId: string) =>
    `${roomId}:${principal.principalType}:${principal.principalId}`;
  const store: GateRoomStore = {
    async assertLiveKitGateReady() {},
    async getLiveKitGatePrincipalEpoch({ principal, roomId }) {
      return { status: 'ready', epoch: epochs.get(key(principal, roomId)) || 0 };
    },
    async createLiveKitGateCredential(input) {
      if (revokeDuringCreate) epochs.set(key(input.principal, input.roomId), (input.principalEpoch ?? 0) + 1);
      rows.set(input.credentialHash, input);
      return { status: 'created' };
    },
    async verifyLiveKitGateCredential(input) {
      const row = rows.get(input.credentialHash);
      const epoch = epochs.get(`${input.roomId}:${input.principalType}:${input.principalId}`) || 0;
      return row &&
        row.peerId === input.peerId &&
        row.principalEpoch === input.principalEpoch &&
        epoch === input.principalEpoch
        ? { status: 'allowed' }
        : { status: 'denied' };
    },
    async revokeLiveKitGatePrincipal({ principal, roomId }) {
      const next = (epochs.get(key(principal, roomId)) || 0) + 1;
      epochs.set(key(principal, roomId), next);
      return { status: 'revoked', epoch: next };
    }
  };
  const principal: GatePrincipal = { principalType: 'account', principalId: 'user-1' };
  const boundary = createCredentialBoundaryService({ roomStore: store, secret: process.env.LIVEKIT_GATE_SECRET });
  const first = credentialOf(await boundary.issueCredential({ roomId: 'room', peerId: 'tab-one', principal }));
  const second = credentialOf(await boundary.issueCredential({ roomId: 'room', peerId: 'tab-two', principal }));
  const restartedGate = createLiveKitAuthGateService({
    boundary,
    roomStore: store,
    upstreamUrl: 'ws://127.0.0.1:7880'
  });
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(first)}`)).ok, true);
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(second)}`)).ok, true);
  const stolenAndTampered = `${first.slice(0, -1)}x`;
  assert.equal(
    (await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(stolenAndTampered)}`)).ok,
    false
  );
  await boundary.revokePrincipal({ roomId: 'room', principal });
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(first)}`)).ok, false);
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(second)}`)).ok, false);
  revokeDuringCreate = true;
  const raced = credentialOf(await boundary.issueCredential({ roomId: 'room', peerId: 'raced', principal }));
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(raced)}`)).ok, false);
});

test(
  'G48-A04 PostgreSQL-backed external HTTP/WS gate survives restart and rejects direct/internal, replay, partition and concurrent reconnect attacks',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
    const pool = new Pool({ connectionString: db.databaseUrl });
    t.after(async () => {
      await pool.end();
      await db.cleanup();
    });
    const store = createRoomStore({ pool });
    await store.createRoom({ roomId: 'g48-network', creatorIp: '127.0.0.1' });
    const principal: GatePrincipal = { principalType: 'account', principalId: 'g48-account' };
    const boundary = createCredentialBoundaryService({ roomStore: store, secret: process.env.LIVEKIT_GATE_SECRET });
    const upstream = net.createServer((socket) => {
      let request = '';
      socket.on('data', (chunk: Buffer) => {
        request += chunk.toString();
        if (!request.includes('\r\n\r\n')) return;
        const direct = request.includes('vr_gate_credential=');
        socket.end(
          direct
            ? 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'
            : 'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
        );
      });
    });
    const upstreamPort = await listen(upstream);
    t.after(() => close(upstream));
    const issued = (
      await Promise.all(
        ['tab-a', 'tab-b'].map((peerId) => boundary.issueCredential({ roomId: 'g48-network', peerId, principal }))
      )
    ).map(credentialOf);
    const [tabA] = issued;
    assert.ok(tabA);
    const makeGate = () =>
      createLiveKitAuthGateService({
        boundary,
        roomStore: store,
        upstreamUrl: `ws://127.0.0.1:${upstreamPort}`
      }).createServer();
    let gate = makeGate();
    let gatePort = await listen(gate);
    // The gate also binds the LiveKit JWT to the credential; mint a matching unsigned
    // one from the credential's own claims (LiveKit, not the gate, checks signatures).
    const accessTokenFor = (credential: string) => {
      const claims = JSON.parse(Buffer.from(credential.split('.')[1] || '', 'base64url').toString('utf8') || '{}') as {
        peer?: string;
        room?: string;
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${encode({ alg: 'HS256' })}.${encode({ sub: claims.peer, nbf: Math.floor(Date.now() / 1000), video: { room: `voice-room-${claims.room}` } })}.signature`;
    };
    const pathFor = (credential: string) => {
      let token = '';
      try {
        token = accessTokenFor(credential);
      } catch {}
      return `/rtc?access_token=${token}&vr_gate_credential=${encodeURIComponent(credential)}`;
    };
    assert.match(await upgrade(gatePort, pathFor(tabA)), /^HTTP\/1\.1 101/);
    assert.match(await upgrade(upstreamPort, pathFor(tabA)), /^HTTP\/1\.1 403/);
    await close(gate);
    gate = makeGate();
    gatePort = await listen(gate);
    t.after(() => close(gate));
    const concurrent = await Promise.all(issued.map((credential) => upgrade(gatePort, pathFor(credential))));
    assert.ok(concurrent.every((response) => /^HTTP\/1\.1 101/.test(response)));
    const tampered = `${tabA.slice(0, -1)}x`;
    assert.match(await upgrade(gatePort, pathFor(tampered)), /^HTTP\/1\.1 403/);
    await boundary.revokePrincipal({ roomId: 'g48-network', principal });
    for (const credential of issued) assert.match(await upgrade(gatePort, pathFor(credential)), /^HTTP\/1\.1 403/);
    const racedPromise = boundary.issueCredential({ roomId: 'g48-network', peerId: 'race', principal });
    const revokePromise = boundary.revokePrincipal({ roomId: 'g48-network', principal });
    const [raced] = await Promise.all([racedPromise, revokePromise]);
    await boundary.revokePrincipal({ roomId: 'g48-network', principal });
    if (raced.credential) assert.match(await upgrade(gatePort, pathFor(raced.credential.value)), /^HTTP\/1\.1 403/);
    await close(gate);
    gate = makeGate();
    gatePort = await listen(gate);
    assert.match(await upgrade(gatePort, pathFor(tabA)), /^HTTP\/1\.1 403/);
    assert.match(
      fs.readFileSync(path.resolve(import.meta.dirname, '../../../docker-compose.dev.yml'), 'utf8'),
      /livekit\/livekit-server:v1\.13\.2/
    );
  }
);

test(
  'G48-A03 PostgreSQL admission cleanup revokes only the failed tab credential',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    resetMetricsForTest();
    const db = await createTestDatabase(t);
    await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
    const pool = new Pool({ connectionString: db.databaseUrl });
    t.after(async () => {
      await pool.end();
      await db.cleanup();
    });
    const store = createRoomStore({ pool });
    const roomId = 'g48-cleanup';
    await store.createRoom({ roomId, creatorIp: '127.0.0.1' });
    const principal: GatePrincipal = { principalType: 'account', principalId: 'g48-multitab-account' };
    const boundary = createCredentialBoundaryService({ roomStore: store, secret: process.env.LIVEKIT_GATE_SECRET });
    const healthy = credentialOf(await boundary.issueCredential({ roomId, peerId: 'healthy-tab', principal }));
    // Set inside the credential provider the app calls.
    const failed: { credential?: IssuedCredential } = {};
    const app = createApiApp({
      store: withRosterPeer(store, { id: 'failed-tab', sessionToken: 'goodtoken123456789012345678901234' }),
      users: {
        async getSessionUser() {
          return { user: { id: principal.principalId, avatarColorKey: 'green' } };
        }
      },
      liveKitCredentials: {
        async issueAdmission(input: Parameters<CredentialProvider['issueAdmission']>[0]) {
          const issued = await boundary.issueCredential({
            roomId: input.roomId,
            peerId: input.peerId,
            principal: input.principal
          });
          assert.ok(issued.credential);
          failed.credential = issued.credential;
          return {
            status: 'issued',
            admission: {
              gateCredentialId: issued.credential.id,
              room: input.livekitRoom,
              token: 'must-not-leak',
              ttlSeconds: 60,
              url: `ws://gate.test/rtc?vr_gate_credential=${encodeURIComponent(issued.credential.value)}`
            }
          };
        }
      },
      membershipServicesOverride: {
        service: {
          async persistSuccessfulAdmission() {
            throw new Error('membership unavailable');
          }
        }
      }
    });
    t.after(() => app.close());
    const response = await app.inject({
      method: 'POST',
      url: '/api/livekit-token',
      headers: { cookie: 'vr_session=session' },
      payload: { name: 'Account', peerId: 'failed-tab', roomId, sessionToken: 'goodtoken123456789012345678901234' }
    });
    assert.equal(response.statusCode, 500);
    const failedCredential = failed.credential;
    assert.ok(failedCredential);
    assert.doesNotMatch(response.body, /must-not-leak/);
    assert.doesNotMatch(response.body, new RegExp(failedCredential.id));
    assert.doesNotMatch(response.body, new RegExp(failedCredential.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const gate = createLiveKitAuthGateService({ boundary, roomStore: store, upstreamUrl: 'ws://127.0.0.1:7880' });
    assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(healthy)}`)).ok, true);
    assert.equal(
      (await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(failedCredential.value)}`)).ok,
      false
    );
    assert.match(renderPrometheus(), /voice_room_credential_revoke_cleanup_failures_total 0/);
    const another = credentialOf(await boundary.issueCredential({ roomId, peerId: 'another-tab', principal }));
    assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(another)}`)).ok, true);
    await boundary.revokePrincipal({ roomId, principal });
    assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(healthy)}`)).ok, false);
    assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(another)}`)).ok, false);
  }
);

test('G48-A03 issued credential fails closed when membership persistence and revoke both fail', async (t) => {
  resetMetricsForTest();
  type CreateRoomInput = { roomId: string; creatorIp: string; isStatic: boolean; name?: string; now?: number };
  const rooms = new Map<string, Record<string, unknown>>();
  const store = {
    async countQuotaRoomsForIp() {
      return 0;
    },
    async countRooms() {
      return rooms.size;
    },
    async createRoom({ roomId, creatorIp, isStatic, name = '', now = Date.now() }: CreateRoomInput) {
      const room = {
        id: roomId,
        creatorIp,
        isStatic,
        name,
        createdAt: now,
        updatedAt: now,
        emptySince: now,
        peers: new Map()
      };
      rooms.set(roomId, room);
      return room;
    },
    async createRoomWithQuota(input: CreateRoomInput) {
      return { status: 'created', room: await this.createRoom(input) };
    },
    async getRoom(id: string) {
      return rooms.get(id) || null;
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {},
    async listSummaryRecipientUserIds() {
      return [];
    },
    async getOrCreatePeerIdentity({ peerId }: { peerId: string }) {
      return { status: 'created', identity: { id: peerId, peerId, avatarColorKey: 'green' } };
    },
    normalizeGatePrincipal({
      accountUserId,
      guestPrincipalId,
      roomId
    }: {
      accountUserId: string | null;
      guestPrincipalId: string;
      roomId: string;
    }) {
      return accountUserId
        ? { principalType: 'account', principalId: accountUserId }
        : { principalType: 'guest', principalId: `${roomId}:${guestPrincipalId}` };
    },
    async isRoomServerMuted() {
      return false;
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
    async revokeLiveKitGateCredential() {
      throw new Error('revoke unavailable');
    },
    async revokeLiveKitGatePrincipal() {
      return { status: 'revoked', epoch: 1 };
    }
  };
  const app = createApiApp({
    store: withRosterPeer(store, { id: 'peer0001', sessionToken: 'goodtoken123456789012345678901234' }),
    users: {
      async getSessionUser() {
        return { user: { id: 'account', avatarColorKey: 'green' } };
      }
    },
    liveKitCredentials: {
      async issueAdmission() {
        return {
          status: 'issued',
          admission: { gateCredentialId: 'credential', token: 'issued', room: 'room', url: 'ws://gate', ttlSeconds: 60 }
        };
      }
    },
    membershipServicesOverride: {
      service: {
        async persistSuccessfulAdmission() {
          throw new Error('membership unavailable');
        }
      }
    }
  });
  t.after(() => app.close());
  const room = await app.inject({ method: 'POST', url: '/api/rooms', payload: { isStatic: false } });
  const response = await app.inject({
    method: 'POST',
    url: '/api/livekit-token',
    headers: { cookie: 'vr_session=session' },
    payload: {
      name: 'Account',
      peerId: 'peer0001',
      roomId: room.json<{ roomId: string }>().roomId,
      sessionToken: 'goodtoken123456789012345678901234'
    }
  });
  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(response.body, /issued/);
  assert.match(renderPrometheus(), /voice_room_credential_revoke_cleanup_failures_total 1/);
});
