// A deploy stops the API with SIGTERM. Every second it spends stopping is a
// second the site and the realtime channel are down, so a peer that does not
// answer the close handshake or a request still in flight must not hold the
// process until the hard timeout.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { installGracefulShutdown } from '../src/app/graceful-shutdown.ts';
import { recordingLogger } from './fakes/index.ts';

async function listening(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

function rawConnection(port: number, payload: string): Promise<net.Socket> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(payload);
      resolve(socket);
    });
    socket.on('error', () => {});
  });
}

test('a realtime peer that never answers the close and a request still in flight do not hold the shutdown', async (t) => {
  const server = http.createServer(() => {
    // Never answers: a request in flight when the deploy stops the process.
  });
  const realtime = new WebSocketServer({ server });
  const sockets: WebSocket[] = [];
  realtime.on('connection', (socket) => sockets.push(socket));
  const port = await listening(server);

  // A WebSocket upgrade whose client then goes silent, like a frozen tab behind the proxy.
  const silentPeer = await rawConnection(
    port,
    'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
  );
  const inFlight = await rawConnection(port, 'GET /slow HTTP/1.1\r\nHost: x\r\n\r\n');
  t.after(() => {
    silentPeer.destroy();
    inFlight.destroy();
  });
  while (sockets.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));

  const exits: number[] = [];
  const logger = recordingLogger();
  const shutdown = installGracefulShutdown(server, {
    logger,
    sockets: () => sockets.map((socket) => ({ socket })),
    closeStores: async () => {},
    exit: (code) => exits.push(code),
    timeoutMs: 5_000,
    socketGraceMs: 100,
    signals: new EventEmitter() as unknown as Pick<NodeJS.Process, 'once'>
  });

  const finished = await Promise.race([
    shutdown('SIGTERM').then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000).unref())
  ]);

  assert.equal(finished, true, 'the shutdown finishes within two seconds');
  assert.deepEqual(exits, [0]);
  assert.equal(server.listening, false);
});

test('the shutdown log says how long each step took', async () => {
  const logger = recordingLogger();
  const server = http.createServer();
  await listening(server);
  const shutdown = installGracefulShutdown(server, {
    logger,
    sockets: () => [],
    closeStores: async () => {},
    exit: () => {},
    signals: new EventEmitter() as unknown as Pick<NodeJS.Process, 'once'>
  });

  await shutdown('SIGTERM');

  const done = logger.records.find((record) => record.evt === 'boot.shutdown_completed');
  assert.ok(done, 'a completion record is written');
  for (const step of ['socketsMs', 'serverMs', 'storesMs']) {
    assert.equal(typeof done[step], 'number', `${step} is recorded`);
  }
});

test('the LiveKit gate stops at once on SIGTERM, cutting the signal connections it proxies', async (t) => {
  const { installGateShutdown } = await import('../src/domains/admission/livekit-auth-gate.service.ts');
  const server = http.createServer(() => {});
  const exits: number[] = [];
  let poolClosed = false;
  const signals = new EventEmitter();
  const shutdown = installGateShutdown(server, {
    logger: recordingLogger(),
    closePool: async () => {
      poolClosed = true;
    },
    exit: (code) => exits.push(code),
    signals: signals as unknown as Pick<NodeJS.Process, 'once'>
  });
  const port = await listening(server);
  // An open signal connection: an upgrade the gate is proxying never ends by itself.
  const signal = await rawConnection(port, 'GET /rtc HTTP/1.1\r\nHost: x\r\n\r\n');
  t.after(() => signal.destroy());
  const cut = new Promise((resolve) => signal.once('close', resolve));

  const finished = await Promise.race([
    shutdown('SIGTERM').then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000).unref())
  ]);

  assert.equal(finished, true, 'the gate stops within a second');
  await cut;
  assert.deepEqual(exits, [0]);
  assert.equal(poolClosed, true);
  assert.equal(server.listening, false);
});
