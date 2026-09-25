import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { LoginAlerts, Me } from '@voice-room/shared/contracts/account';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';
import { openWs, waitForClose, waitForWsType } from './ws-harness.ts';

async function startServer(t: TestContext) {
  const { socketPath } = await startApiServer(t, { prefix: 'voice-room-login-alerts-', env: { AUTH_RATE_LIMIT: '0' } });
  return socketPath;
}

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const SESSION_ENDED_CLOSE_CODE = 4401;

async function signIn(socketPath: string, userAgent: string, { register = false } = {}) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: register ? '/api/auth/register' : '/api/auth/login',
    headers: { 'User-Agent': userAgent },
    body: register
      ? { login: 'ada', password: 'password123', passwordConfirm: 'password123' }
      : { login: 'ada', password: 'password123' }
  });
  assert.equal(response.status, register ? 201 : 200);
  return cookieFrom(response.setCookie);
}

async function me(socketPath: string, cookie: string) {
  return (await request<Me>(socketPath, { pathname: '/api/auth/me', cookie })).body.user;
}

test('a sign-in from a new device asks the open devices live, and "Это не я" ends it everywhere', async (t) => {
  const socketPath = await startServer(t);
  const laptop = await signIn(socketPath, CHROME_WINDOWS, { register: true });
  assert.equal((await request(socketPath, { pathname: '/api/auth/login-alerts' })).status, 401);

  const laptopSocket = openWs(socketPath, { cookie: laptop });
  await laptopSocket.ready;

  const stranger = await signIn(socketPath, FIREFOX_LINUX);
  const announced = await waitForWsType(laptopSocket.frames, 'account.login.new');
  assert.equal(announced.payload.alert.client, 'Firefox');
  assert.equal(announced.payload.alert.os, 'Linux');
  assert.equal(announced.payload.alert.kind, 'login');
  assert.equal('sessionPublicId' in announced.payload.alert, false);

  const pending = await request<LoginAlerts>(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop });
  assert.equal(pending.status, 200);
  assert.deepEqual(
    pending.body.alerts.map((alert) => alert.id),
    [announced.payload.alert.id]
  );
  const ownView = await request<LoginAlerts>(socketPath, { pathname: '/api/auth/login-alerts', cookie: stranger });
  assert.deepEqual(ownView.body.alerts, [], 'the new device is not asked about itself');

  const strangerSocket = openWs(socketPath, { cookie: stranger });
  await strangerSocket.ready;
  const strangerClosed = waitForClose(strangerSocket.ws);

  const alertId = announced.payload.alert.id;
  const ownAnswer = await request(socketPath, {
    method: 'POST',
    pathname: `/api/auth/login-alerts/${alertId}/confirm`,
    cookie: stranger,
    body: {}
  });
  assert.equal(ownAnswer.status, 404);

  const denied = await request(socketPath, {
    method: 'POST',
    pathname: `/api/auth/login-alerts/${alertId}/deny`,
    cookie: laptop,
    body: {}
  });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.sessionEnded, true);
  assert.deepEqual(denied.body.recoveryCodes, { remaining: 0, generatedAt: null });
  assert.equal(await strangerClosed, SESSION_ENDED_CLOSE_CODE);
  assert.equal(await me(socketPath, stranger), null);
  assert.equal((await me(socketPath, laptop))?.login, 'ada');

  const resolved = await waitForWsType(laptopSocket.frames, 'account.login.resolved');
  assert.deepEqual(resolved.payload, { alertId, resolution: 'denied' });

  const again = await request(socketPath, {
    method: 'POST',
    pathname: `/api/auth/login-alerts/${alertId}/deny`,
    cookie: laptop,
    body: {}
  });
  assert.equal(again.status, 404);

  // A denied device asks again; confirming it makes the next sign-in quiet.
  const strangerBack = await signIn(socketPath, FIREFOX_LINUX);
  const [secondAlert] = (await request<LoginAlerts>(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop }))
    .body.alerts;
  assert.ok(secondAlert);
  const confirmed = await request(socketPath, {
    method: 'POST',
    pathname: `/api/auth/login-alerts/${secondAlert.id}/confirm`,
    cookie: laptop,
    body: {}
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await me(socketPath, strangerBack))?.login, 'ada');

  await signIn(socketPath, FIREFOX_LINUX);
  assert.deepEqual(
    (await request<LoginAlerts>(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop })).body.alerts,
    []
  );
  laptopSocket.ws.close();
});
