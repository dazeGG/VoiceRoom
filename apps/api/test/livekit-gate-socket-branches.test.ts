// The LiveKit auth gate sits on raw sockets, and a socket can go away at any
// moment: before the gate answers, while authorization is still pending, or
// between the upstream connecting and the tunnel being written. Each of those
// must end in a closed socket rather than a write into a dead one or a crash
// of the whole gate process. These cases are the gate's strict branch budget.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test, { mock } from 'node:test';

import type { CredentialBoundaryService, GateRoomStore } from '../src/domains/admission/credential-boundary.service.ts';
import type { GateClaims } from '../src/domains/admission/gate-credential-signer.ts';
import { createLiveKitAuthGateService } from '../src/domains/admission/livekit-auth-gate.service.ts';
import { fake } from './fakes/index.ts';

class FakeSocket extends EventEmitter {
  destroyed = false;
  writable: boolean;
  writableEnded = false;
  writes: string[] = [];
  throwOnWrite: boolean;
  end?: (data?: string | Buffer) => void;

  constructor({ writable = true, withEnd = true, throwOnWrite = false } = {}) {
    super();
    this.writable = writable;
    this.throwOnWrite = throwOnWrite;
    if (withEnd) {
      this.end = (data?: string | Buffer) => {
        if (this.throwOnWrite) throw new Error('end failed');
        if (data !== undefined) this.writes.push(data.toString());
        this.writableEnded = true;
      };
    }
  }

  write(data: string | Buffer) {
    if (this.throwOnWrite) throw new Error('write failed');
    this.writes.push(data.toString());
    return true;
  }

  destroy() {
    this.destroyed = true;
  }

  pipe<T>(destination: T): T {
    return destination;
  }
}

// A credential and a LiveKit JWT that belong to the same admission, so the
// token-binding check passes and the socket branches below are what is tested.
const CLAIMS = {
  cid: 'cid-1',
  exp: Date.now() + 60_000,
  iat: Date.now(),
  peer: 'peer-1',
  pEpoch: 1,
  pId: 'guest-1',
  pType: 'guest',
  room: 'room-1'
} satisfies GateClaims;
const ACCESS_TOKEN = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({ sub: 'peer-1', nbf: Math.floor(Date.now() / 1000), video: { room: 'voice-room-room-1' } })
  ).toString('base64url'),
  'signature'
].join('.');

type GateError = { evt?: string; msg?: string | undefined };

function createGate({ errors = new Array<GateError>() } = {}) {
  const boundary = fake<CredentialBoundaryService>({
    authorizeCredential: async () => ({ ok: true as const, claims: CLAIMS }),
    assertReady: async () => true as const
  });
  const service = createLiveKitAuthGateService({
    boundary,
    roomStore: fake<GateRoomStore>(),
    logger: {
      error: (fields: GateError, msg?: string) => errors.push({ ...fields, msg }),
      warn: () => {}
    },
    upstreamUrl: 'ws://127.0.0.1:7880'
  });
  return service.createServer();
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const upgradeRequest = (url = `/rtc?access_token=${ACCESS_TOKEN}&vr_gate_credential=credential`) => ({
  url,
  headers: {}
});

function withConnect(factory: () => unknown, run: () => unknown) {
  // The gate opens its upstream with net.connect; the test swaps in a fake socket.
  const connect = mock.method(net, 'connect', factory);
  return Promise.resolve(run()).finally(() => {
    connect.mock.restore();
  });
}

test('a denied upgrade on a socket that can no longer be written is only closed', () => {
  const server = createGate();
  const client = new FakeSocket({ writable: false });

  server.emit('upgrade', upgradeRequest('/elsewhere'), client, Buffer.alloc(0));

  assert.equal(client.destroyed, true);
  assert.deepEqual(client.writes, []);
});

test('a denied upgrade answers through end() when the socket offers it', () => {
  const server = createGate();
  const client = new FakeSocket();

  server.emit('upgrade', upgradeRequest('/elsewhere'), client, Buffer.alloc(0));

  assert.match(client.writes[0] ?? '', /^HTTP\/1\.1 404 Not Found/);
  assert.equal(client.writableEnded, true);
});

test('a denied upgrade without end() writes the answer and then closes', () => {
  const server = createGate();
  const client = new FakeSocket({ withEnd: false });

  server.emit('upgrade', upgradeRequest('/elsewhere'), client, Buffer.alloc(0));

  assert.match(client.writes[0] ?? '', /^HTTP\/1\.1 404 Not Found/);
  assert.equal(client.destroyed, true);
});

test('a denial that fails to write still closes the socket instead of throwing', () => {
  const server = createGate();
  const client = new FakeSocket({ throwOnWrite: true });

  assert.doesNotThrow(() => server.emit('upgrade', upgradeRequest('/elsewhere'), client, Buffer.alloc(0)));
  assert.equal(client.destroyed, true);
});

test('a client that leaves while authorization is pending never opens an upstream', async () => {
  const server = createGate();
  const client = new FakeSocket();
  let connects = 0;

  await withConnect(
    () => {
      connects += 1;
      return new FakeSocket();
    },
    async () => {
      server.emit('upgrade', upgradeRequest(), client, Buffer.alloc(0));
      client.writable = false;
      await flush();
    }
  );

  assert.equal(connects, 0);
});

test('an upstream that connects after the client left is closed, not written', async () => {
  const server = createGate();
  const client = new FakeSocket();
  const upstream = new FakeSocket();

  await withConnect(
    () => upstream,
    async () => {
      server.emit('upgrade', upgradeRequest(), client, Buffer.alloc(0));
      await flush();
      client.destroyed = true;
      upstream.emit('connect');
    }
  );

  assert.equal(upstream.destroyed, true);
  assert.deepEqual(upstream.writes, []);
});

test('an upstream write that throws tears down both sockets and is logged', async () => {
  const errors: GateError[] = [];
  const server = createGate({ errors });
  const client = new FakeSocket();
  const upstream = new FakeSocket({ throwOnWrite: true });

  await withConnect(
    () => upstream,
    async () => {
      server.emit('upgrade', upgradeRequest(), client, Buffer.from('head'));
      await flush();
      upstream.emit('connect');
    }
  );

  assert.equal(client.destroyed, true);
  assert.equal(upstream.destroyed, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.evt, 'livekit.gate_upstream_failed');
  assert.match(errors[0]?.msg ?? '', /upstream connection failed/);
});

test(
  'widget recovery ACK fences a delayed upstream connect callback and preserves main tunnels',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { createTestDatabase } = await import('./db-harness.ts');
    const { createWidgetRuntimeOwner } = await import('../src/domains/rooms/widget-runtime-owner.repository.ts');
    const { runWidgetRecovery } = await import('../src/scripts/widget-recovery.ts');
    const db = await createTestDatabase(t);
    await db.pool.query(
      "UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true;INSERT INTO rooms(id,kind,empty_since) VALUES('room-1','widget',now()),('main-room','main',now())"
    );
    const api = createWidgetRuntimeOwner({ pool: db.pool, role: 'api', quiesce: async () => true, lost: () => {} });
    await api.start();
    let active: Promise<void> | null = null;
    const timer = setInterval(() => {
      active ??= api.tick().finally(() => {
        active = null;
      });
    }, 20);
    const service = createLiveKitAuthGateService({
      pool: db.pool,
      boundary: fake<CredentialBoundaryService>({
        authorizeCredential: async (credential) => ({
          ok: true,
          claims: { ...CLAIMS, room: credential === 'main' ? 'main-room' : 'room-1' }
        }),
        assertReady: async () => true
      }),
      upstreamUrl: 'ws://127.0.0.1:7880'
    });
    await service.start();
    const server = service.createServer();
    t.after(async () => {
      clearInterval(timer);
      await active;
      await service.stop();
      await api.stop();
      await db.cleanup();
    });
    const upstreams: FakeSocket[] = [];
    await withConnect(
      () => {
        const socket = new FakeSocket();
        upstreams.push(socket);
        return socket;
      },
      async () => {
        const widget = new FakeSocket();
        server.emit('upgrade', upgradeRequest(), widget, Buffer.alloc(0));
        const deadline = Date.now() + 5000;
        while (upstreams.length < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(upstreams.length, 1);
        const main = new FakeSocket();
        const token = [
          Buffer.from('{}').toString('base64url'),
          Buffer.from(
            JSON.stringify({
              sub: 'peer-1',
              nbf: Math.floor(Date.now() / 1000),
              video: { room: 'voice-room-main-room' }
            })
          ).toString('base64url'),
          'sig'
        ].join('.');
        server.emit(
          'upgrade',
          upgradeRequest(`/rtc?access_token=${token}&vr_gate_credential=main`),
          main,
          Buffer.alloc(0)
        );
        while (upstreams.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(upstreams.length, 2);
        upstreams[1]?.emit('connect');
        await flush();
        assert.match(upstreams[1]?.writes[0] ?? '', /^GET /);
        const receipt = await runWidgetRecovery({
          pool: db.pool,
          media: {
            async listRooms() {
              return [];
            },
            async deleteRoom() {}
          },
          prefix: 'voice-room-',
          command: 'recover'
        });
        assert.equal(receipt.widgetGateQuiescent, true);
        assert.equal(widget.destroyed, true);
        assert.equal(upstreams[0]?.destroyed, true);
        assert.equal(main.destroyed, false);
        assert.equal(upstreams[1]?.destroyed, false);
        upstreams[0]?.emit('connect');
        await flush();
        assert.deepEqual(upstreams[0]?.writes, [], 'old callback cannot send revoked JWT after acknowledged recovery');
      }
    );
  }
);

test(
  'unclassified delayed gate authorization blocks ACK until cancelled and cannot resume after receipt',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { createTestDatabase } = await import('./db-harness.ts');
    const { createWidgetRuntimeOwner } = await import('../src/domains/rooms/widget-runtime-owner.repository.ts');
    const { runWidgetRecovery } = await import('../src/scripts/widget-recovery.ts');
    const db = await createTestDatabase(t);
    await db.pool.query(
      "UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true;INSERT INTO rooms(id,kind,empty_since)VALUES('room-1','widget',now())"
    );
    const api = createWidgetRuntimeOwner({ pool: db.pool, role: 'api', quiesce: async () => true, lost: () => {} });
    await api.start();
    let active: Promise<void> | null = null;
    const timer = setInterval(() => {
      active ??= api.tick().finally(() => {
        active = null;
      });
    }, 20);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createLiveKitAuthGateService({
      pool: db.pool,
      boundary: fake<CredentialBoundaryService>({
        authorizeCredential: async () => {
          await held;
          return { ok: true, claims: CLAIMS };
        },
        assertReady: async () => true
      }),
      upstreamUrl: 'ws://127.0.0.1:7880'
    });
    await service.start();
    const server = service.createServer();
    t.after(async () => {
      release();
      clearInterval(timer);
      await active;
      await service.stop();
      await api.stop();
      await db.cleanup();
    });
    let opened = 0;
    await withConnect(
      () => {
        opened++;
        return new FakeSocket();
      },
      async () => {
        const client = new FakeSocket();
        server.emit('upgrade', upgradeRequest(), client, Buffer.alloc(0));
        let complete = false;
        const recovering = runWidgetRecovery({
          pool: db.pool,
          media: {
            async listRooms() {
              return [];
            },
            async deleteRoom() {}
          },
          prefix: 'voice-room-',
          command: 'recover'
        }).then((result) => {
          complete = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(complete, false, 'unknown pre-auth upgrade prevents acknowledgement');
        // The bounded unknown-auth timeout cancels this handle before a gate ACK may be emitted.
        const receipt = await recovering;
        assert.equal(receipt.widgetGateQuiescent, true);
        assert.equal(client.destroyed, true);
        release();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(opened, 0, 'late authorization result cannot recreate an upstream after receipt');
      }
    );
  }
);
