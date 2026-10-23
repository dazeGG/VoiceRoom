// An Android app below ANDROID_MIN_VERSION: HTTP 426 on the API, close 4426
// on the WebSocket before `ready`, and the policy route that tells it why
// always answers. Browsers, the desktop app and current apps pass.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { ClientPolicy } from '@voice-room/shared/contracts/client';
import { Capabilities } from '@voice-room/shared/contracts/ops';
import { Failure } from '@voice-room/shared/contracts/http';
import { createApiRuntime } from '../src/app/api-runtime.ts';
import { checked } from './helpers/checked.ts';
import { openWs } from './ws-harness.ts';

const OUTDATED = 'VoiceRoom-Android/1.1.9';
const CURRENT = 'VoiceRoom-Android/1.2.0';
const CHROME =
  'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

function createApp(t: TestContext, androidMinVersion: string) {
  const app = createApiRuntime({ env: { ...process.env, ANDROID_MIN_VERSION: androidMinVersion } }).createApp();
  t.after(() => app.close());
  return app;
}

function get(app: ReturnType<typeof createApp>, url: string, userAgent?: string) {
  return app.inject({ method: 'GET', url, headers: userAgent === undefined ? {} : { 'user-agent': userAgent } });
}

async function listen(app: ReturnType<typeof createApp>): Promise<number> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

/** Opens a socket with this user agent; resolves with how the server closed it and how many frames came first. */
function closedSocket(port: number, userAgent: string): Promise<{ code: number; reason: string; frames: number }> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, { headers: { 'User-Agent': userAgent } });
    const timer = setTimeout(() => reject(new Error('Socket was not closed')), 5000);
    ws.on('message', () => {
      frames += 1;
    });
    ws.on('error', reject);
    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString('utf8'), frames });
    });
  });
}

test('an outdated Android app gets 426 client_outdated on an API path, with or without a query string', async (t) => {
  const app = createApp(t, '1.2.0');
  for (const url of ['/api/rooms', '/api/rooms?x=1', '/api/capabilities']) {
    const response = await get(app, url, OUTDATED);
    assert.equal(response.statusCode, 426, url);
    assert.deepEqual(checked(Failure, response.json()), {
      ok: false,
      error: 'Client outdated',
      code: 'client_outdated'
    });
  }
  // A version that is not plain x.y.z cannot be checked, so it counts as outdated.
  assert.equal((await get(app, '/api/rooms', 'VoiceRoom-Android/1.2')).statusCode, 426);
});

test('the current app, a browser and a request without a user agent pass', async (t) => {
  const app = createApp(t, '1.2.0');
  for (const userAgent of [CURRENT, 'VoiceRoom-Android/1.10.0', CHROME, undefined]) {
    const response = await get(app, '/api/capabilities', userAgent);
    assert.equal(response.statusCode, 200, String(userAgent));
    assert.equal(checked(Capabilities, response.json()).contractVersion, 1);
    assert.notEqual((await get(app, '/api/rooms?x=1', userAgent)).statusCode, 426, String(userAgent));
  }
});

test('the client policy answers every client, an outdated app included, and is not cached', async (t) => {
  const bounded = createApp(t, '1.2.0');
  for (const userAgent of [OUTDATED, CURRENT, CHROME, undefined]) {
    const response = await get(bounded, '/api/client/policy', userAgent);
    assert.equal(response.statusCode, 200, String(userAgent));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(checked(ClientPolicy, response.json()), { contractVersion: 1, android: { minVersion: '1.2.0' } });
  }
  assert.equal((await get(bounded, '/api/client/policy?from=launch', OUTDATED)).statusCode, 200);

  const unbounded = createApp(t, '');
  const response = await get(unbounded, '/api/client/policy', OUTDATED);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(checked(ClientPolicy, response.json()), { contractVersion: 1, android: { minVersion: null } });
});

test('without a minimum version no app is refused', async (t) => {
  const app = createApp(t, '');
  for (const userAgent of [OUTDATED, 'VoiceRoom-Android/0.0.1', 'VoiceRoom-Android/1.2']) {
    assert.equal((await get(app, '/api/capabilities', userAgent)).statusCode, 200, userAgent);
  }
  const port = await listen(app);
  const session = openWs(port, { headers: { 'User-Agent': OUTDATED } });
  t.after(() => session.ws.close());
  assert.equal((await session.ready).type, 'ready');
});

test('an outdated app WebSocket closes with 4426 before ready; a current one gets ready', async (t) => {
  const app = createApp(t, '1.2.0');
  const port = await listen(app);

  const refused = await closedSocket(port, OUTDATED);
  assert.equal(refused.code, 4426);
  assert.equal(refused.reason, 'Client outdated');
  assert.equal(refused.frames, 0);

  for (const userAgent of [CURRENT, CHROME]) {
    const session = openWs(port, { headers: { 'User-Agent': userAgent } });
    t.after(() => session.ws.close());
    assert.equal((await session.ready).type, 'ready', userAgent);
  }
});
