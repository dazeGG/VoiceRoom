// The LiveKit auth gate sits on raw sockets, and a socket can go away at any
// moment: before the gate answers, while authorization is still pending, or
// between the upstream connecting and the tunnel being written. Each of those
// must end in a closed socket rather than a write into a dead one or a crash
// of the whole gate process. These cases are the gate's strict branch budget.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test from 'node:test';

import type { CredentialBoundaryService } from '../src/domains/admission/credential-boundary.service.ts';
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
const CLAIMS = { cid: 'cid-1', iat: Date.now(), peer: 'peer-1', room: 'room-1' };
const ACCESS_TOKEN = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({ sub: 'peer-1', nbf: Math.floor(Date.now() / 1000), video: { room: 'voice-room-room-1' } })
  ).toString('base64url'),
  'signature'
].join('.');

type GateError = { evt?: string; msg?: string };

function createGate({ errors = [] as GateError[] } = {}) {
  const boundary = fake<CredentialBoundaryService>({
    authorizeCredential: async () => ({ ok: true as const, claims: CLAIMS as GateClaims }),
    assertReady: async () => true as const
  });
  const service = createLiveKitAuthGateService({
    boundary,
    roomStore: {},
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
  const original = net.connect;
  // The gate opens its upstream with net.connect; the test swaps in a fake socket.
  net.connect = factory as typeof net.connect;
  return Promise.resolve(run()).finally(() => {
    net.connect = original;
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
