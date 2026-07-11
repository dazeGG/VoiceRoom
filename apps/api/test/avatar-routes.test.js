'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { createApiApp } = require('../src/server');
const { createAvatarStorage } = require('../src/lib/avatar-storage');

const OWNER_ID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER_ID = '123e4567-e89b-12d3-a456-426614174001';
const ROOM_ID = 'abcdefghij';

function multipart(buffer, filename = 'avatar.png') {
  const boundary = '----voice-room-avatar-test';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

function createHarness(uploadsDir) {
  const users = new Map([
    [OWNER_ID, { id: OWNER_ID, login: 'owner', displayName: 'Owner', avatarColorKey: 'blurple', avatarKey: null }],
    [OTHER_ID, { id: OTHER_ID, login: 'other', displayName: 'Other', avatarColorKey: 'green', avatarKey: null }]
  ]);
  const room = {
    id: ROOM_ID,
    name: 'Room',
    ownerId: OWNER_ID,
    isStatic: true,
    avatarKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    emptySince: null,
    peers: new Map()
  };
  const userStore = {
    async getSessionUser(token) {
      const id = token === 'owner-token' ? OWNER_ID : token === 'other-token' ? OTHER_ID : '';
      return id ? { user: { ...users.get(id) } } : null;
    },
    async updateAvatar({ userId, avatarKey = null, avatarAccent = null }) {
      const user = users.get(userId);
      if (!user) return null;
      Object.assign(user, { avatarKey, avatarAccent });
      return { ...user };
    }
  };
  const roomStore = {
    async getRoom(roomId) {
      return roomId === ROOM_ID ? { ...room, peers: new Map() } : null;
    },
    async updateRoomAvatar(roomId, avatarKey = null) {
      if (roomId !== ROOM_ID || !room.isStatic) return null;
      room.avatarKey = avatarKey;
      room.updatedAt = Date.now();
      return { ...room, peers: new Map() };
    }
  };
  const app = createApiApp({
    store: roomStore,
    users: userStore,
    friends: { async getFriendIds() { return []; } },
    notifications: {},
    avatars: createAvatarStorage({ uploadsDir })
  });
  return { app, room, users };
}

function cookie(token) {
  return { cookies: { vr_session: token } };
}

test('avatar routes authorize, normalize, replace, serve, and delete user and room avatars', async (t) => {
  const uploadsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatar-routes-'));
  t.after(() => fs.promises.rm(uploadsDir, { recursive: true, force: true }));
  const { app, room, users } = createHarness(uploadsDir);
  t.after(() => app.close());

  const redPng = await sharp({ create: { width: 24, height: 12, channels: 3, background: '#f02020' } }).png().toBuffer();
  const bluePng = await sharp({ create: { width: 12, height: 24, channels: 3, background: '#2040f0' } }).png().toBuffer();

  const anonymous = await app.inject({ method: 'POST', url: '/api/auth/avatar', ...multipart(redPng) });
  assert.equal(anonymous.statusCode, 401);

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/auth/avatar',
    ...cookie('owner-token'),
    ...multipart(Buffer.from('not an image'), 'avatar.txt')
  });
  assert.equal(invalid.statusCode, 415);

  const first = await app.inject({
    method: 'POST', url: '/api/auth/avatar', ...cookie('owner-token'), ...multipart(redPng)
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = first.json();
  assert.match(firstBody.user.avatarUrl, /^\/api\/avatars\/av_/);
  assert.match(firstBody.user.avatarAccent, /^#[0-9a-f]{6}$/i);
  const firstKey = path.basename(firstBody.user.avatarUrl);

  const served = await app.inject({ method: 'GET', url: firstBody.user.avatarUrl });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/webp');
  assert.equal(served.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.deepEqual(await sharp(served.rawPayload).metadata().then(({ width, height, format }) => ({ width, height, format })), {
    width: 256, height: 256, format: 'webp'
  });

  const replacement = await app.inject({
    method: 'POST', url: '/api/auth/avatar', ...cookie('owner-token'), ...multipart(bluePng)
  });
  assert.equal(replacement.statusCode, 200, replacement.body);
  assert.notEqual(path.basename(replacement.json().user.avatarUrl), firstKey);
  await assert.rejects(fs.promises.access(path.join(uploadsDir, firstKey)), { code: 'ENOENT' });

  const removed = await app.inject({ method: 'DELETE', url: '/api/auth/avatar', ...cookie('owner-token') });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().user.avatarUrl, null);
  assert.equal(removed.json().user.avatarAccent, null);
  assert.equal(users.get(OWNER_ID).avatarKey, null);

  const notOwner = await app.inject({
    method: 'POST', url: `/api/rooms/${ROOM_ID}/avatar`, ...cookie('other-token'), ...multipart(redPng)
  });
  assert.equal(notOwner.statusCode, 403);

  const roomUpload = await app.inject({
    method: 'POST', url: `/api/rooms/${ROOM_ID}/avatar`, ...cookie('owner-token'), ...multipart(redPng)
  });
  assert.equal(roomUpload.statusCode, 200, roomUpload.body);
  assert.match(roomUpload.json().room.avatarUrl, /^\/api\/avatars\/room_/);
  assert.ok(room.avatarKey);
  const firstRoomKey = room.avatarKey;

  const roomReplacement = await app.inject({
    method: 'POST', url: `/api/rooms/${ROOM_ID}/avatar`, ...cookie('owner-token'), ...multipart(bluePng)
  });
  assert.equal(roomReplacement.statusCode, 200, roomReplacement.body);
  assert.notEqual(room.avatarKey, firstRoomKey);
  await assert.rejects(fs.promises.access(path.join(uploadsDir, firstRoomKey)), { code: 'ENOENT' });

  const roomDelete = await app.inject({
    method: 'DELETE', url: `/api/rooms/${ROOM_ID}/avatar`, ...cookie('owner-token')
  });
  assert.equal(roomDelete.statusCode, 200);
  assert.equal(roomDelete.json().room.avatarUrl, null);
  assert.equal(room.avatarKey, null);

  assert.equal((await app.inject({ method: 'GET', url: '/api/avatars/not-a-key.webp' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/avatars/${firstKey}` })).statusCode, 404);
});

test('room avatar writes are limited to owned static rooms and oversized uploads are rejected', async (t) => {
  const uploadsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatar-routes-'));
  t.after(() => fs.promises.rm(uploadsDir, { recursive: true, force: true }));
  const { app, room } = createHarness(uploadsDir);
  t.after(() => app.close());
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#333' } }).png().toBuffer();

  room.isStatic = false;
  const temporary = await app.inject({
    method: 'POST', url: `/api/rooms/${ROOM_ID}/avatar`, ...cookie('owner-token'), ...multipart(image)
  });
  assert.equal(temporary.statusCode, 403);
  room.isStatic = true;

  const oversized = await app.inject({
    method: 'POST',
    url: '/api/auth/avatar',
    ...cookie('owner-token'),
    ...multipart(Buffer.alloc(5 * 1024 * 1024 + 1, 1))
  });
  assert.equal(oversized.statusCode, 413, oversized.body);
});
