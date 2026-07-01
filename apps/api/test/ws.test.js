'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { createTestDatabase } = require('./db-harness');

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-ws-'));
  return { dir, socketPath: path.join(dir, 'api.sock') };
}

function waitForHealthz(socketPath, timeoutMs = 5000) {
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

function startServer(socketPath, databaseUrl, logs) {
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
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => {
    logs.stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs.stderr += chunk.toString();
  });
  return child;
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
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
          setCookie: res.headers['set-cookie'] || []
        });
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

function openWs(socketPath, cookie) {
  const frames = [];
  const ws = new WebSocket(`ws+unix://${socketPath}:/api/ws`, {
    headers: cookie ? { Cookie: cookie } : undefined
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS did not deliver ready')), 5000);
    ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw));
      frames.push(parsed);
      if (parsed.type === 'ready') {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { ws, frames, ready };
}

async function register(socketPath, login) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(response.status, 201);
  return cookieFrom(response.setCookie);
}

async function befriend(socketPath, requesterCookie, addresseeLogin) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/friends/requests',
    cookie: requesterCookie,
    body: { login: addresseeLogin }
  });
  assert.ok(response.status === 200 || response.status === 201);
}

async function acceptFirstRequest(socketPath, cookie) {
  const list = await request(socketPath, { pathname: '/api/friends/requests', cookie });
  assert.equal(list.status, 200);
  const requestId = list.body.incoming[0]?.id;
  assert.ok(requestId);
  const accepted = await request(socketPath, {
    method: 'POST',
    pathname: `/api/friends/requests/${encodeURIComponent(requestId)}/accept`,
    cookie,
    body: {}
  });
  assert.equal(accepted.status, 200);
}

test('ws accepts guest connections with guest ready payload', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const guest = openWs(socketPath);
  const ready = await guest.ready;
  assert.equal(ready.payload.guest, true);
  guest.ws.close();
});

test('ws ready and friend.presence work for authenticated users', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const aliceCookie = await register(socketPath, 'alice');
  const bobCookie = await register(socketPath, 'bob');
  await befriend(socketPath, aliceCookie, 'bob');
  await acceptFirstRequest(socketPath, bobCookie);

  const bobFriends = await request(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice')?.user.id;
  assert.ok(aliceId);

  const bob = openWs(socketPath, bobCookie);
  const bobReady = await bob.ready;
  assert.ok(typeof bobReady.payload.userId === 'string');
  assert.equal(bobReady.payload.onlineFriendIds.length, 0);

  const presence = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bob did not receive friend.presence')), 5000);
    bob.ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw));
      if (parsed.type === 'friend.presence' && parsed.payload?.userId === aliceId) {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
  });

  const alice = openWs(socketPath, aliceCookie);
  const aliceReady = await alice.ready;
  assert.ok(Array.isArray(aliceReady.payload.onlineFriendIds));

  const seen = await presence;
  assert.equal(seen.type, 'friend.presence');
  assert.equal(seen.payload.online, true);

  bob.ws.close();
  alice.ws.close();
});