'use strict';

const { socketPathForDirectory } = require('./ipc-harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');
const { openWs, waitForWsType } = require('./ws-harness');

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const SESSION_ENDED_CLOSE_CODE = 4401;

function waitForHealthz(socketPath, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get({ path: '/api/healthz', socketPath }, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Server did not become ready'));
        return;
      }
      setTimeout(attempt, 50);
    };
    attempt();
  });
}

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-login-alerts-'));
  const socketPath = socketPathForDirectory(dir);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      AUTH_RATE_LIMIT: '0',
      DATABASE_URL: databaseUrl,
      SOCKET_PATH: socketPath
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });
  await waitForHealthz(socketPath);
  return socketPath;
}

function request(socketPath, { method = 'GET', pathname, body, cookie, headers = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const nextHeaders = { Accept: 'application/json', ...headers };
  if (payload) {
    nextHeaders['Content-Type'] = 'application/json';
    nextHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) nextHeaders.Cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers: nextHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null, setCookie: res.headers['set-cookie'] || [] });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie) {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header || '').split(';')[0];
}

async function signIn(socketPath, userAgent, { register = false } = {}) {
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

function waitForClose(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket was not closed')), timeoutMs);
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function me(socketPath, cookie) {
  return (await request(socketPath, { pathname: '/api/auth/me', cookie })).body.user;
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

  const pending = await request(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop });
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.alerts.map((alert) => alert.id), [announced.payload.alert.id]);
  const ownView = await request(socketPath, { pathname: '/api/auth/login-alerts', cookie: stranger });
  assert.deepEqual(ownView.body.alerts, [], 'the new device is not asked about itself');

  const strangerSocket = openWs(socketPath, { cookie: stranger });
  await strangerSocket.ready;
  const strangerClosed = waitForClose(strangerSocket.ws);

  const alertId = announced.payload.alert.id;
  const ownAnswer = await request(socketPath, { method: 'POST', pathname: `/api/auth/login-alerts/${alertId}/confirm`, cookie: stranger, body: {} });
  assert.equal(ownAnswer.status, 404);

  const denied = await request(socketPath, { method: 'POST', pathname: `/api/auth/login-alerts/${alertId}/deny`, cookie: laptop, body: {} });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.sessionEnded, true);
  assert.deepEqual(denied.body.recoveryCodes, { remaining: 0, generatedAt: null });
  assert.equal(await strangerClosed, SESSION_ENDED_CLOSE_CODE);
  assert.equal(await me(socketPath, stranger), null);
  assert.equal((await me(socketPath, laptop)).login, 'ada');

  const resolved = await waitForWsType(laptopSocket.frames, 'account.login.resolved');
  assert.deepEqual(resolved.payload, { alertId, resolution: 'denied' });

  const again = await request(socketPath, { method: 'POST', pathname: `/api/auth/login-alerts/${alertId}/deny`, cookie: laptop, body: {} });
  assert.equal(again.status, 404);

  // A denied device asks again; confirming it makes the next sign-in quiet.
  const strangerBack = await signIn(socketPath, FIREFOX_LINUX);
  const [secondAlert] = (await request(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop })).body.alerts;
  assert.ok(secondAlert);
  const confirmed = await request(socketPath, { method: 'POST', pathname: `/api/auth/login-alerts/${secondAlert.id}/confirm`, cookie: laptop, body: {} });
  assert.equal(confirmed.status, 200);
  assert.equal((await me(socketPath, strangerBack)).login, 'ada');

  await signIn(socketPath, FIREFOX_LINUX);
  assert.deepEqual((await request(socketPath, { pathname: '/api/auth/login-alerts', cookie: laptop })).body.alerts, []);
  laptopSocket.ws.close();
});
