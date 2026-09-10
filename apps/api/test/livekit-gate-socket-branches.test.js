'use strict';

// The LiveKit auth gate sits on raw sockets, and a socket can go away at any
// moment: before the gate answers, while authorization is still pending, or
// between the upstream connecting and the tunnel being written. Each of those
// must end in a closed socket rather than a write into a dead one or a crash
// of the whole gate process. These cases are the gate's strict branch budget.

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const test = require('node:test');

const { createLiveKitAuthGateService } = require('../src/domains/admission/livekit-auth-gate-service');

class FakeSocket extends EventEmitter {
  constructor({ writable = true, withEnd = true, throwOnWrite = false } = {}) {
    super();
    this.destroyed = false;
    this.writable = writable;
    this.writableEnded = false;
    this.writes = [];
    this.throwOnWrite = throwOnWrite;
    if (withEnd) {
      this.end = (data) => {
        if (this.throwOnWrite) throw new Error('end failed');
        if (data !== undefined) this.writes.push(String(data));
        this.writableEnded = true;
      };
    }
  }

  write(data) {
    if (this.throwOnWrite) throw new Error('write failed');
    this.writes.push(data);
    return true;
  }

  destroy() {
    this.destroyed = true;
  }

  pipe(destination) {
    return destination;
  }
}

function createGate({ errors = [] } = {}) {
  const boundary = {
    authorizeCredential: async () => ({ ok: true, claims: {} }),
    assertReady: async () => {}
  };
  const service = createLiveKitAuthGateService({
    boundary,
    roomStore: {},
    logger: { error: (...args) => errors.push(args) },
    upstreamUrl: 'ws://127.0.0.1:7880'
  });
  return service.createServer();
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const upgradeRequest = (url = '/rtc?vr_gate_credential=credential') => ({ url, headers: {} });

function withConnect(factory, run) {
  const original = net.connect;
  net.connect = factory;
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

  assert.match(client.writes[0], /^HTTP\/1\.1 404 Not Found/);
  assert.equal(client.writableEnded, true);
});

test('a denied upgrade without end() writes the answer and then closes', () => {
  const server = createGate();
  const client = new FakeSocket({ withEnd: false });

  server.emit('upgrade', upgradeRequest('/elsewhere'), client, Buffer.alloc(0));

  assert.match(String(client.writes[0]), /^HTTP\/1\.1 404 Not Found/);
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

  await withConnect(() => {
    connects += 1;
    return new FakeSocket();
  }, async () => {
    server.emit('upgrade', upgradeRequest(), client, Buffer.alloc(0));
    client.writable = false;
    await flush();
  });

  assert.equal(connects, 0);
});

test('an upstream that connects after the client left is closed, not written', async () => {
  const server = createGate();
  const client = new FakeSocket();
  const upstream = new FakeSocket();

  await withConnect(() => upstream, async () => {
    server.emit('upgrade', upgradeRequest(), client, Buffer.alloc(0));
    await flush();
    client.destroyed = true;
    upstream.emit('connect');
  });

  assert.equal(upstream.destroyed, true);
  assert.deepEqual(upstream.writes, []);
});

test('an upstream write that throws tears down both sockets and is logged', async () => {
  const errors = [];
  const server = createGate({ errors });
  const client = new FakeSocket();
  const upstream = new FakeSocket({ throwOnWrite: true });

  await withConnect(() => upstream, async () => {
    server.emit('upgrade', upgradeRequest(), client, Buffer.from('head'));
    await flush();
    upstream.emit('connect');
  });

  assert.equal(client.destroyed, true);
  assert.equal(upstream.destroyed, true);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /upstream connection failed/);
});
