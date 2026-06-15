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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-auth-'));
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

// Reduce a Set-Cookie header into a `name=value` Cookie string for the next call.
function cookieFrom(setCookie) {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header || '').split(';')[0];
}

test('auth flow: register, session, owned rooms, logout', async (t) => {
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

  // Register sets a session cookie and returns the public user.
  const registered = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'Vovosh', displayName: 'Вова', password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.login, 'vovosh');
  assert.equal(registered.body.user.displayName, 'Вова');
  assert.equal('passwordHash' in registered.body.user, false);
  const cookie = cookieFrom(registered.setCookie);
  assert.match(cookie, /^vr_session=/);

  // /auth/me reflects the session.
  const me = await request(socketPath, { pathname: '/api/auth/me', cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.login, 'vovosh');
  assert.ok(me.body.user.avatarColorKey);

  // Without the cookie there is no session.
  const anon = await request(socketPath, { pathname: '/api/auth/me' });
  assert.equal(anon.status, 200);
  assert.equal(anon.body.user, null);

  const malformedCookie = await request(socketPath, { pathname: '/api/auth/me', cookie: 'vr_session=%' });
  assert.equal(malformedCookie.status, 200);
  assert.equal(malformedCookie.body.user, null);

  // Static rooms cannot be created anonymously in v2.
  const anonStatic = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: true, name: 'анон' }
  });
  assert.equal(anonStatic.status, 401);

  // A static room created while authenticated is owned and listed back,
  // carrying the name and emoji chosen at creation.
  const room = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: true, name: '  квартирник  ', roomPresetKey: 'game-indigo' },
    cookie
  });
  assert.equal(room.status, 201);
  assert.equal(room.body.owned, true);
  assert.equal(room.body.name, 'квартирник');
  assert.equal(room.body.emoji, '🎮');
  assert.equal(room.body.roomIconKey, 'gamepad');
  assert.equal(room.body.roomColorKey, 'indigo');
  assert.equal(room.body.roomPresetKey, 'game-indigo');

  // Unknown emoji is rejected, name is still kept; visual keys fall back to the default preset.
  const fancyRoom = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: true, name: 'дейли', emoji: '🦄' },
    cookie
  });
  assert.equal(fancyRoom.body.emoji, '🎧');
  assert.equal(fancyRoom.body.roomIconKey, 'headphones');
  assert.equal(fancyRoom.body.roomColorKey, 'blue');
  assert.equal(fancyRoom.body.name, 'дейли');

  const thirdRoom = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: true, name: 'планёрка' },
    cookie
  });
  assert.equal(thirdRoom.status, 201);
  assert.equal(thirdRoom.body.owned, true);

  const fourthRoom = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: true, name: 'лимит' },
    cookie
  });
  assert.equal(fourthRoom.status, 429);

  // A temporary room (no isStatic) stays ownerless even when authenticated.
  const tempRoom = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    body: { isStatic: false },
    cookie
  });
  assert.equal(tempRoom.body.owned, false);

  const rooms = await request(socketPath, { pathname: '/api/auth/rooms', cookie });
  assert.equal(rooms.status, 200);
  // Both owned static rooms are listed; the temporary one is not.
  assert.deepEqual(
    new Set(rooms.body.rooms.map((entry) => entry.roomId)),
    new Set([room.body.roomId, fancyRoom.body.roomId, thirdRoom.body.roomId])
  );
  const listed = rooms.body.rooms.find((entry) => entry.roomId === room.body.roomId);
  assert.equal(listed.name, 'квартирник');
  assert.equal(listed.emoji, '🎧');
  assert.equal(listed.relationship, 'owner');

  // Adding an already owned room by code is idempotent and the lobby keeps the
  // stronger owner relationship instead of duplicating the row.
  const ownBookmark = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/rooms',
    body: { roomId: room.body.roomId },
    cookie
  });
  assert.equal(ownBookmark.status, 200);
  assert.equal(ownBookmark.body.room.relationship, 'owner');
  const afterOwnBookmark = await request(socketPath, { pathname: '/api/auth/rooms', cookie });
  assert.equal(afterOwnBookmark.body.rooms.filter((entry) => entry.roomId === room.body.roomId).length, 1);
  assert.equal(afterOwnBookmark.body.rooms.find((entry) => entry.roomId === room.body.roomId).relationship, 'owner');

  const secondUser = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'listener', password: 'password123' }
  });
  assert.equal(secondUser.status, 201);
  const secondCookie = cookieFrom(secondUser.setCookie);

  const bookmarked = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/rooms',
    body: { code: room.body.roomId },
    cookie: secondCookie
  });
  assert.equal(bookmarked.status, 200);
  assert.equal(bookmarked.body.room.relationship, 'bookmarked');
  const bookmarkedAgain = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/rooms',
    body: { code: room.body.roomId },
    cookie: secondCookie
  });
  assert.equal(bookmarkedAgain.status, 200);
  assert.equal(bookmarkedAgain.body.room.roomId, room.body.roomId);

  const secondRooms = await request(socketPath, { pathname: '/api/auth/rooms', cookie: secondCookie });
  assert.deepEqual(secondRooms.body.rooms.map((entry) => [entry.roomId, entry.relationship]), [
    [room.body.roomId, 'bookmarked']
  ]);

  const tempBookmark = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/rooms',
    body: { roomId: tempRoom.body.roomId },
    cookie: secondCookie
  });
  assert.equal(tempBookmark.status, 400);

  // Listing rooms requires a session.
  const roomsAnon = await request(socketPath, { pathname: '/api/auth/rooms' });
  assert.equal(roomsAnon.status, 401);

  // Logout clears the cookie and invalidates the session.
  const loggedOut = await request(socketPath, { method: 'POST', pathname: '/api/auth/logout', cookie });
  assert.equal(loggedOut.status, 200);
  assert.match(cookieFrom(loggedOut.setCookie), /^vr_session=/);
  const afterLogout = await request(socketPath, { pathname: '/api/auth/me', cookie });
  assert.equal(afterLogout.body.user, null);
});

test('auth flow: validation, duplicate login, and wrong password', async (t) => {
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

  const shortPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'ada', password: 'short' }
  });
  assert.equal(shortPassword.status, 400);

  const mismatch = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'ada', password: 'password123', passwordConfirm: 'password124' }
  });
  assert.equal(mismatch.status, 400);

  const created = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'ada', password: 'password123' }
  });
  assert.equal(created.status, 201);

  const duplicate = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login: 'ada', password: 'password123' }
  });
  assert.equal(duplicate.status, 409);

  const wrongPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'ada', password: 'nope-nope-nope' }
  });
  assert.equal(wrongPassword.status, 401);

  const ok = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'ada', password: 'password123' }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.login, 'ada');
});
