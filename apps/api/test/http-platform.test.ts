// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
// Security headers, the request log line and graceful shutdown
// (platform/http/security-headers.ts, platform/http/request-log.ts,
// app/graceful-shutdown.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { liveKitConnectSources, securityHeaders } from '../src/platform/http/security-headers.ts';
import { createRequestLog, requestRouteLabel } from '../src/platform/http/request-log.ts';
import { installGracefulShutdown } from '../src/app/graceful-shutdown.ts';

test('LiveKit connect sources treat localhost and 127.0.0.1 as one host', () => {
  assert.deepEqual(liveKitConnectSources(''), []);
  assert.deepEqual(liveKitConnectSources('not a url'), []);
  assert.deepEqual(liveKitConnectSources('wss://gate.example/rtc'), ['wss://gate.example']);
  assert.deepEqual(liveKitConnectSources('ws://localhost:7880'), ['ws://localhost:7880', 'ws://127.0.0.1:7880']);
  assert.deepEqual(liveKitConnectSources('ws://127.0.0.1:7880'), ['ws://127.0.0.1:7880', 'ws://localhost:7880']);
});

test('the CSP admits the gate everywhere and the local SFU only outside production', () => {
  const dev = securityHeaders({ connectSources: ['wss://gate.example'], production: false });
  assert.match(
    dev['Content-Security-Policy'],
    /connect-src 'self' wss:\/\/gate\.example ws:\/\/localhost:7880 ws:\/\/127\.0\.0\.1:7880 stun: turn: turns:/
  );
  assert.match(dev['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(dev['X-Content-Type-Options'], 'nosniff');
  const prod = securityHeaders({ connectSources: [], production: true });
  assert.doesNotMatch(prod['Content-Security-Policy'], /localhost/);
  assert.match(prod['Permissions-Policy'], /camera=\(\)/);
});

test('the request line is levelled by status, skips health checks and hashes the address', () => {
  const lines = [];
  const log = {
    info: (fields) => lines.push(['info', fields]),
    warn: (fields) => lines.push(['warn', fields]),
    error: (fields) => lines.push(['error', fields])
  };
  const logRequest = createRequestLog({ clientIp: () => '203.0.113.9', hashIp: (ip) => `hash(${ip})` });
  const request = (url, extra = {}) => ({
    method: 'GET',
    routeOptions: { url },
    raw: { voiceRoomUserId: 'u1' },
    log,
    ...extra
  });
  logRequest(request('/api/healthz'), 200, 1);
  logRequest(request('/api/rooms'), 200, 1.234);
  logRequest(request('/api/rooms'), 404, 2);
  logRequest(request('/api/rooms'), 503, 3);
  logRequest({ method: 'GET', url: '/raw', log }, 200, 1);
  assert.deepEqual(
    lines.map(([level]) => level),
    ['info', 'warn', 'error', 'info']
  );
  assert.deepEqual(lines[0][1], {
    evt: 'http.request',
    method: 'GET',
    route: '/api/rooms',
    statusCode: 200,
    userId: 'u1',
    ipHash: 'hash(203.0.113.9)',
    durationMs: 1.23
  });
  assert.equal(lines[3][1].userId, undefined);
  logRequest({ method: 'GET', url: '/nolog' }, 200, 1);
  assert.equal(requestRouteLabel({}), 'unknown');
  assert.equal(requestRouteLabel({ routerPath: '/legacy' }), '/legacy');
});

function shutdownHarness({ closeFails = false, hang = false } = {}) {
  const calls = { exits: [], closedSockets: [], stores: 0, logs: [] };
  const signals = new EventEmitter();
  const server = {
    close(callback) {
      if (!hang) callback();
    }
  };
  const sockets = [
    { socket: { close: (code) => calls.closedSockets.push(code) } },
    {
      socket: {
        close: () => {
          throw new Error('gone');
        }
      }
    }
  ];
  const shutdown = installGracefulShutdown(server, {
    logger: { info: (fields) => calls.logs.push(fields.evt), error: (fields) => calls.logs.push(fields.evt) },
    sockets: () => sockets,
    closeStores: async () => {
      calls.stores += 1;
      if (closeFails) throw new Error('db');
    },
    exit: (code) => calls.exits.push(code),
    timeoutMs: 20,
    signals
  });
  return { calls, shutdown, signals };
}

test('shutdown closes sockets, the server and the stores once, then exits cleanly', async () => {
  const { calls, shutdown, signals } = shutdownHarness();
  signals.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  await shutdown('SIGINT');
  assert.deepEqual(calls.closedSockets, [1001]);
  assert.equal(calls.stores, 1);
  assert.deepEqual(calls.exits, [0]);
  assert.deepEqual(calls.logs, ['boot.shutdown_started']);
});

test('a failed or hanging shutdown exits with 1', async () => {
  const failing = shutdownHarness({ closeFails: true });
  await failing.shutdown('SIGTERM');
  assert.deepEqual(failing.calls.exits, [1]);
  assert.ok(failing.calls.logs.includes('boot.shutdown_failed'));

  const hanging = shutdownHarness({ hang: true });
  void hanging.shutdown('SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(hanging.calls.exits, [1]);
  assert.ok(hanging.calls.logs.includes('boot.shutdown_timeout'));
});
