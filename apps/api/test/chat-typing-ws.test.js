import { socketPathForDirectory } from './ipc-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createTestDatabase } from './db-harness.js';
import {
  countWsType,
  joinVoiceRoom,
  openWs,
  sendWs,
  subscribeRoomPreview,
  waitForWsType
} from './ws-harness.js';

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-typing-'));
  const socketPath = socketPathForDirectory(dir);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: path.join(import.meta.dirname, '..'),
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
  const sockets = [];
  t.after(async () => {
    for (const session of sockets) session.ws.close();
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);

  return {
    async register(login) {
      const response = await request(socketPath, {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
      });
      assert.equal(response.status, 201);
      const cookie = String(response.setCookie[0] || '').split(';')[0];
      return { cookie, id: response.body.user.id };
    },
    async befriend(requester, addressee, addresseeLogin) {
      const sent = await request(socketPath, { method: 'POST', pathname: '/api/friends/requests', cookie: requester.cookie, body: { login: addresseeLogin } });
      assert.ok(sent.status === 200 || sent.status === 201);
      const list = await request(socketPath, { pathname: '/api/friends/requests', cookie: addressee.cookie });
      const requestId = list.body.incoming[0]?.id;
      assert.ok(requestId);
      const accepted = await request(socketPath, { method: 'POST', pathname: `/api/friends/requests/${requestId}/accept`, cookie: addressee.cookie, body: {} });
      assert.equal(accepted.status, 200);
    },
    async createRoom(owner) {
      const created = await request(socketPath, { method: 'POST', pathname: '/api/rooms', cookie: owner.cookie, body: { isStatic: true, name: 'Печатают' } });
      assert.equal(created.status, 201);
      return created.body.roomId;
    },
    async connect(cookie) {
      const session = openWs(socketPath, cookie ? { cookie } : {});
      sockets.push(session);
      await session.ready;
      return session;
    }
  };
}

test('typing in a direct thread reaches only a friend, at most once a second', async (t) => {
  const server = await startServer(t);
  const alice = await server.register('alice');
  const bob = await server.register('bob');
  const carol = await server.register('carol');
  await server.befriend(alice, bob, 'bob');

  const aliceWs = await server.connect(alice.cookie);
  const bobWs = await server.connect(bob.cookie);
  const carolWs = await server.connect(carol.cookie);
  const guestWs = await server.connect();

  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  const notice = await waitForWsType(bobWs.frames, 'dm.typing');
  assert.deepEqual(notice.payload, { userId: alice.id, activity: 'typing' });

  // Repeats inside a second are dropped; strangers and guests reach nobody.
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(carolWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(guestWs.ws, 'dm.typing', { userId: bob.id });
  await delay(400);
  assert.equal(countWsType(bobWs.frames, 'dm.typing'), 1);
  assert.equal(countWsType(aliceWs.frames, 'dm.typing'), 0, 'the sender is not told about their own typing');

  await delay(700);
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  await waitForWsType(bobWs.frames, 'dm.typing', () => countWsType(bobWs.frames, 'dm.typing') === 2);

  sendWs(aliceWs.ws, 'dm.typing', { userId: 'bob' });
  const rejected = await waitForWsType(aliceWs.frames, 'error');
  assert.equal(rejected.error.code, 'invalid_user_id');
});

test('room typing reaches everyone with the chat open, named by the server and never echoed', async (t) => {
  const server = await startServer(t);
  const owner = await server.register('roomowner');
  const viewer = await server.register('viewer');
  const outsider = await server.register('outsider');
  const roomId = await server.createRoom(owner);

  const ownerWs = await server.connect(owner.cookie);
  const viewerWs = await server.connect(viewer.cookie);
  const outsiderWs = await server.connect(outsider.cookie);
  const guestWs = await server.connect();
  await subscribeRoomPreview(ownerWs, roomId);
  await subscribeRoomPreview(viewerWs, roomId);
  await joinVoiceRoom(guestWs, { roomId, peerId: 'guest-typing-peer', sessionToken: 'g'.repeat(32), name: 'Гость Петя' });

  sendWs(guestWs.ws, 'room.chat.typing', { roomId, name: 'Подделка' });
  for (const session of [ownerWs, viewerWs]) {
    const notice = await waitForWsType(session.frames, 'room.chat.typing');
    assert.deepEqual(notice.payload, { roomId, typist: { peerId: 'guest-typing-peer', userId: null, name: 'Гость Петя' }, activity: 'typing' });
  }

  sendWs(ownerWs.ws, 'room.chat.typing', { roomId });
  const fromOwner = await waitForWsType(guestWs.frames, 'room.chat.typing');
  assert.deepEqual(fromOwner.payload.typist, { peerId: `auth-${owner.id}`, userId: owner.id, name: 'roomowner' });
  await waitForWsType(viewerWs.frames, 'room.chat.typing', (frame) => frame.payload.typist.userId === owner.id);

  // Someone without the chat open cannot announce anything in it.
  sendWs(outsiderWs.ws, 'room.chat.typing', { roomId });
  await delay(400);
  assert.equal(countWsType(ownerWs.frames, 'room.chat.typing'), 1, 'only the guest reached the owner');
  assert.equal(countWsType(guestWs.frames, 'room.chat.typing'), 1, 'only the owner reached the guest');
  assert.equal(countWsType(viewerWs.frames, 'room.chat.typing'), 2);
  assert.equal(countWsType(outsiderWs.frames, 'room.chat.typing'), 0);
});

test('a notice says whether someone types or picks an emoji, and switching is not held back by the other one', async (t) => {
  const server = await startServer(t);
  const dana = await server.register('dana');
  const erik = await server.register('erik');
  await server.befriend(dana, erik, 'erik');
  const roomId = await server.createRoom(dana);

  const danaWs = await server.connect(dana.cookie);
  const erikWs = await server.connect(erik.cookie);

  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id, activity: 'emoji' });
  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id, activity: 'emoji' });
  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id });
  await waitForWsType(erikWs.frames, 'dm.typing', () => countWsType(erikWs.frames, 'dm.typing') === 2);
  await delay(400);
  const direct = erikWs.frames.filter((frame) => frame.type === 'dm.typing').map((frame) => frame.payload);
  assert.deepEqual(direct, [
    { userId: dana.id, activity: 'emoji' },
    { userId: dana.id, activity: 'typing' }
  ], 'a repeated emoji notice inside a second is dropped, the switch to typing arrives when the second is up');

  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id, activity: 'recording' });
  const rejected = await waitForWsType(danaWs.frames, 'error');
  assert.equal(rejected.error.code, 'invalid_typing_activity');

  await subscribeRoomPreview(danaWs, roomId);
  await subscribeRoomPreview(erikWs, roomId);
  sendWs(erikWs.ws, 'room.chat.typing', { roomId, activity: 'emoji' });
  sendWs(erikWs.ws, 'room.chat.typing', { roomId, activity: 'typing' });
  await waitForWsType(danaWs.frames, 'room.chat.typing', () => countWsType(danaWs.frames, 'room.chat.typing') === 2);
  const inRoom = danaWs.frames.filter((frame) => frame.type === 'room.chat.typing').map((frame) => frame.payload.activity);
  assert.deepEqual(inRoom, ['emoji', 'typing']);
});
