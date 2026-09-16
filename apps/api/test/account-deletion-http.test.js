'use strict';

const { socketPathForDirectory } = require('./ipc-harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const { createAccountDeletionRepository } = require('../src/domains/account/account-deletion-repository');
const { ACCOUNT_DELETION_GRACE_MS } = require('@voice-room/shared/account-security');
const { createTestDatabase } = require('./db-harness');

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

function request(socketPath, { method = 'GET', pathname, body, cookie } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers = { Accept: 'application/json' };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) headers.Cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers }, (res) => {
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

test('an account can be deleted, restored within the grace period and never re-registered afterwards', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-account-deletion-'));
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
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    child.kill('SIGTERM');
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);

  const credentials = { login: 'ada', password: 'lovelace-1843' };
  const registered = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { ...credentials, passwordConfirm: credentials.password }
  });
  assert.equal(registered.status, 201);
  const cookie = cookieFrom(registered.setCookie);

  assert.equal((await request(socketPath, { pathname: '/api/auth/account/deletion' })).status, 401);
  const preview = await request(socketPath, { pathname: '/api/auth/account/deletion', cookie });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.rooms, []);
  assert.equal(preview.body.graceDays, 7);

  const wrongPassword = await request(socketPath, { method: 'POST', pathname: '/api/auth/account/deletion', cookie, body: { currentPassword: 'nope' } });
  assert.equal(wrongPassword.status, 400);

  const requested = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/deletion',
    cookie,
    body: { currentPassword: credentials.password }
  });
  assert.equal(requested.status, 200);
  assert.ok(requested.body.deletionScheduledFor > Date.now() + ACCOUNT_DELETION_GRACE_MS - 60_000);
  assert.match(String(requested.setCookie[0] || ''), /Max-Age=0/);
  assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie })).body.user, null);

  const pendingLogin = await request(socketPath, { method: 'POST', pathname: '/api/auth/login', body: credentials });
  assert.equal(pendingLogin.status, 409);
  assert.equal(pendingLogin.body.code, 'account_deletion_pending');
  assert.equal(pendingLogin.body.deletionScheduledFor, requested.body.deletionScheduledFor);
  assert.equal(pendingLogin.setCookie.length, 0);

  assert.equal((await request(socketPath, { method: 'POST', pathname: '/api/auth/account/restore', body: { ...credentials, password: 'nope' } })).status, 401);
  const restored = await request(socketPath, { method: 'POST', pathname: '/api/auth/account/restore', body: credentials });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.login, 'ada');
  const restoredCookie = cookieFrom(restored.setCookie);
  assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie: restoredCookie })).body.user.login, 'ada');

  // Delete again and let the grace period run out.
  const again = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/deletion',
    cookie: restoredCookie,
    body: { currentPassword: credentials.password }
  });
  assert.equal(again.status, 200);
  const deletion = createAccountDeletionRepository({ pool });
  const [userId] = await deletion.listDueDeletions({ now: again.body.deletionScheduledFor + 1 });
  assert.ok(userId);
  assert.equal((await deletion.finalizeDeletion({ userId, now: again.body.deletionScheduledFor + 1 })).status, 'deleted');

  assert.equal((await request(socketPath, { method: 'POST', pathname: '/api/auth/login', body: credentials })).status, 401);
  assert.equal((await request(socketPath, { method: 'POST', pathname: '/api/auth/account/restore', body: credentials })).status, 401);
  for (const login of ['ada', 'deleted-anything']) {
    const reuse = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login, password: 'another-password', passwordConfirm: 'another-password' }
    });
    assert.equal(reuse.status, 409, `${login} must stay taken`);
  }
});
