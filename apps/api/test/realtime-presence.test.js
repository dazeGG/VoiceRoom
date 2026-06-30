'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-realtime-'));
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

function openRealtimeStream(socketPath, cookie) {
  const frames = [];
  let buffer = '';
  let closed = false;
  let resolveClosed = null;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const markClosed = () => {
    closed = true;
    resolveClosed?.();
  };

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime stream did not deliver ready')), 5000);
    const req = http.get(
      { socketPath, path: '/api/realtime', headers: cookie ? { cookie } : undefined },
      (res) => {
        res.setEncoding('utf8');
        res.on('end', markClosed);
        res.on('close', markClosed);
        res.on('data', (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            const parsed = JSON.parse(dataLine.slice(5).trim());
            frames.push(parsed);
            if (parsed.type === 'ready') {
              clearTimeout(timer);
              resolve(parsed);
            }
          }
        });
      }
    );
    req.on('error', (error) => {
      markClosed();
      reject(error);
    });
  });

  return { frames, ready, closed: closedPromise };
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
  return response.body;
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

test('realtime ready reports online friends and fans out presence', async (t) => {
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
  const aliceFriends = await request(socketPath, { pathname: '/api/friends', cookie: aliceCookie });
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice')?.user.id;
  const bobId = aliceFriends.body.friends.find((entry) => entry.user.login === 'bob')?.user.id;
  assert.ok(aliceId);
  assert.ok(bobId);

  const bobStream = openRealtimeStream(socketPath, bobCookie);
  const bobReady = await bobStream.ready;
  assert.ok(Array.isArray(bobReady.onlineFriendIds));
  assert.equal(bobReady.onlineFriendIds.length, 0);

  const aliceStream = openRealtimeStream(socketPath, aliceCookie);
  const aliceReady = await aliceStream.ready;
  assert.deepEqual(aliceReady.onlineFriendIds, [bobId]);

  const bobPresence = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bob did not receive presence update')), 5000);
    const check = () => {
      const presence = bobStream.frames.find(
        (frame) => frame.type === 'presence' && frame.userId === aliceId && frame.online === true
      );
      if (presence) {
        clearTimeout(timer);
        resolve(presence);
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
  assert.equal(bobPresence.online, true);

  const friendsForBob = await request(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  assert.equal(friendsForBob.status, 200);
  const aliceEntry = friendsForBob.body.friends.find((entry) => entry.user.login === 'alice');
  assert.ok(aliceEntry);
  assert.equal(aliceEntry.online, true);
});