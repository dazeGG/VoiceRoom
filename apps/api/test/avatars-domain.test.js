// Branch-by-branch proofs for avatars and served images (domains/media/avatars.*):
// the service on fake storage and stores, the routes on a bare Fastify app
// with the multipart plugin. avatar-routes.test.js covers the real stack.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import sharp from 'sharp';

import { createAvatarsService } from '../src/domains/media/avatars.service.ts';
import { readAvatarUpload, registerAvatarRoutes } from '../src/domains/media/avatars.routes.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366ff' } }).png().toBuffer();
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_ID = 'abcdefghij';
const VALID_KEY = `av_${USER_ID}_0123abcd.webp`;

function openedStream() {
  const stream = new PassThrough();
  queueMicrotask(() => { stream.emit('open'); stream.end('webp-bytes'); });
  return stream;
}

function failingStream(error) {
  const stream = new PassThrough();
  queueMicrotask(() => stream.emit('error', error));
  return stream;
}

function harness({ userResult, roomResult, removeFails = false, readError = null } = {}) {
  const calls = { saved: [], removed: [], refreshed: [], friends: [], announced: [], errors: [] };
  const storage = {
    async save(key) { calls.saved.push(key); },
    async remove(key) { if (removeFails) throw new Error('disk'); calls.removed.push(key); },
    createReadStream(key) {
      if (readError === 'sync') throw new TypeError('bad key');
      return readError ? failingStream(readError) : openedStream(key);
    }
  };
  const service = createAvatarsService({
    storage: () => storage,
    linkPreviewStorage: () => storage,
    users: () => ({ async swapAvatar(input) { return userResult ? userResult(input) : { user: { id: input.userId, avatarKey: input.avatarKey ?? null }, previousAvatarKey: 'old.webp' }; } }),
    rooms: () => ({ async swapRoomAvatar(roomId, key) { return roomResult ? roomResult(key) : { room: { id: roomId, avatarKey: key }, previousAvatarKey: 'old-room.webp' }; } }),
    refreshActiveProfile: (user) => calls.refreshed.push(user.id),
    broadcastProfileToFriends: async (user) => { calls.friends.push(user.id); },
    announceRoomUpdate: (roomId) => { calls.announced.push(roomId); return { roomId }; }
  });
  const log = { error: (fields) => calls.errors.push(fields.avatarKey) };
  return { calls, service, log };
}

test('a new account avatar replaces and removes the old file and reaches friends', async () => {
  const { calls, service, log } = harness();
  const result = await service.setUserAvatar({ id: USER_ID }, PNG, log);
  assert.equal(result.status, 'updated');
  assert.equal(calls.saved.length, 1);
  assert.match(calls.saved[0], new RegExp(`^av_${USER_ID}_[0-9a-f]{8}\.webp$`));
  assert.deepEqual(calls.removed, ['old.webp']);
  assert.deepEqual([calls.refreshed, calls.friends], [[USER_ID], [USER_ID]]);
  assert.ok(result.user.avatarUrl);
});

test('an unchanged upload keeps its file; a vanished account removes the new one', async () => {
  const same = harness({ userResult: (input) => ({ user: { id: input.userId, avatarKey: input.avatarKey }, previousAvatarKey: input.avatarKey }) });
  await same.service.setUserAvatar({ id: USER_ID }, PNG, same.log);
  assert.deepEqual(same.calls.removed, []);

  const gone = harness({ userResult: () => ({ user: null }) });
  assert.equal((await gone.service.setUserAvatar({ id: USER_ID }, PNG, gone.log)).status, 'not_found');
  assert.deepEqual(gone.calls.removed, gone.calls.saved);
  const goneSame = harness({ userResult: () => ({ user: null }) });
  const key = (await harness().service.setUserAvatar({ id: USER_ID }, PNG)).user.avatarUrl.split('/api/avatars/')[1];
  await goneSame.service.setUserAvatar({ id: USER_ID, avatarKey: decodeURIComponent(key) }, PNG, goneSame.log);
  assert.deepEqual(goneSame.calls.removed, []);
});

test('clearing an account avatar, and removal failures are only logged', async () => {
  const { calls, service, log } = harness({ removeFails: true });
  assert.equal((await service.clearUserAvatar('user-1', log)).status, 'updated');
  assert.deepEqual(calls.errors, ['old.webp']);
  await service.removeFile(null, log);
  await service.removeFile('x.webp', undefined);
  assert.equal((await harness({ userResult: () => ({ user: null }) }).service.clearUserAvatar('user-1')).status, 'not_found');
});

test('room avatars swap, announce the room card and clean up', async () => {
  const { calls, service, log } = harness();
  assert.deepEqual(await service.setRoomAvatar({ id: ROOM_ID }, PNG, log), { status: 'updated', room: { roomId: ROOM_ID } });
  assert.deepEqual(calls.removed, ['old-room.webp']);
  assert.deepEqual(await service.clearRoomAvatar('room-1', log), { status: 'updated', room: { roomId: 'room-1' } });

  const gone = harness({ roomResult: () => ({ room: null }) });
  assert.equal((await gone.service.setRoomAvatar({ id: ROOM_ID }, PNG, gone.log)).status, 'not_found');
  assert.deepEqual(gone.calls.removed, gone.calls.saved);
  assert.equal((await gone.service.clearRoomAvatar('room-1')).status, 'not_found');
  const same = harness({ roomResult: (key) => ({ room: { id: 'room-1' }, previousAvatarKey: key }) });
  await same.service.setRoomAvatar({ id: ROOM_ID }, PNG);
  assert.deepEqual(same.calls.removed, []);
  const goneSame = harness({ roomResult: () => ({ room: null }) });
  await goneSame.service.setRoomAvatar({ id: ROOM_ID, avatarKey: null }, PNG);
  assert.equal(goneSame.calls.removed.length, 1);
});

test('opening served images: valid keys, missing files and bad keys', async () => {
  assert.ok(await harness().service.openAvatar(VALID_KEY));
  assert.equal(await harness().service.openAvatar('../etc/passwd'), null);
  assert.equal(await harness({ readError: Object.assign(new Error('gone'), { code: 'ENOENT' }) }).service.openAvatar(VALID_KEY), null);
  await assert.rejects(harness({ readError: new Error('io') }).service.openAvatar(VALID_KEY), /io/);
  assert.ok(await harness().service.openLinkPreviewImage('preview.webp'));
  assert.equal(await harness({ readError: 'sync' }).service.openLinkPreviewImage('bad'), null);
});

// --- routes --------------------------------------------------------------------------

function multipart(field, content, filename = 'a.png') {
  const boundary = '----voiceroom';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function routeApp(t, outcomes = {}, { user = { id: 'owner-1' }, room = { id: 'room-1', ownerId: 'owner-1', isStatic: true }, limited = false } = {}) {
  const app = fastify();
  app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, parts: 2 } });
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen = {};
  const record = (name, value) => async (...args) => { seen[name] = args; return outcomes[name] ?? value; };
  registerAvatarRoutes(app, {
    logger: null,
    clientIp: () => 'ip',
    resolveSession: async () => (user ? { user } : null),
    hashIp: (ip) => ip
  }, {
    avatars: {
      setUserAvatar: record('setUserAvatar', { status: 'updated', user: { id: 'owner-1' } }),
      clearUserAvatar: record('clearUserAvatar', { status: 'updated', user: { id: 'owner-1' } }),
      setRoomAvatar: record('setRoomAvatar', { status: 'updated', room: { roomId: 'room-1' } }),
      clearRoomAvatar: record('clearRoomAvatar', { status: 'updated', room: { roomId: 'room-1' } }),
      openAvatar: async (key) => (key === 'missing' ? null : Readable.from(['img'])),
      openLinkPreviewImage: async (key) => (key === 'missing' ? null : Readable.from(['img'])),
      removeFile: async () => {}
    },
    rooms: {
      async checkOwner(userId, roomId) {
        if (!userId) return { status: 'unauthenticated' };
        if (!room || room.id !== roomId) return { status: 'not_found' };
        return room.ownerId === userId ? { status: 'owner', room } : { status: 'forbidden' };
      }
    },
    uploadLimiter: { check: () => (limited ? { allowed: false, retryAfterSeconds: 8 } : { allowed: true }) }
  });
  t.after(() => app.close());
  return { app, seen };
}

async function call(app, method, url, extra = {}) {
  const response = await app.inject({ method, url, ...extra });
  let body = null;
  try { body = response.json(); } catch { body = response.body; }
  return { status: response.statusCode, body, headers: response.headers };
}

test('uploads read the avatar field and answer the service outcome', async (t) => {
  const { app, seen } = routeApp(t);
  const uploaded = await call(app, 'POST', '/api/auth/avatar', multipart('avatar', PNG));
  assert.deepEqual([uploaded.status, uploaded.body], [200, { ok: true, user: { id: 'owner-1' } }]);
  assert.deepEqual(seen.setUserAvatar[1], PNG);
  assert.deepEqual((await call(app, 'POST', '/api/rooms/room-1/avatar', multipart('avatar', PNG))).body, { ok: true, room: { roomId: 'room-1' } });
  assert.deepEqual((await call(app, 'DELETE', '/api/auth/avatar')).body, { ok: true, user: { id: 'owner-1' } });
  assert.deepEqual((await call(app, 'DELETE', '/api/rooms/room-1/avatar')).body, { ok: true, room: { roomId: 'room-1' } });

  const wrongField = await call(app, 'POST', '/api/auth/avatar', multipart('picture', PNG));
  assert.deepEqual([wrongField.status, wrongField.body.error], [400, 'Multipart field "avatar" is required']);
  const tooBig = await call(app, 'POST', '/api/auth/avatar', multipart('avatar', Buffer.alloc(5 * 1024 * 1024 + 10)));
  assert.deepEqual([tooBig.status, tooBig.body.error], [413, 'Avatar file must be at most 5 MB']);
  const notMultipart = await call(app, 'POST', '/api/auth/avatar', { payload: {} });
  assert.equal(notMultipart.status >= 400, true);
});

test('avatar refusals: session, owner, limit and vanished targets', async (t) => {
  assert.equal((await call(routeApp(t, {}, { user: null }).app, 'POST', '/api/auth/avatar', multipart('avatar', PNG))).status, 401);
  assert.equal((await call(routeApp(t, {}, { user: null }).app, 'DELETE', '/api/auth/avatar')).status, 401);
  for (const [options, status] of [[{ user: null }, 401], [{ room: null }, 404], [{ user: { id: 'other' } }, 403]]) {
    assert.equal((await call(routeApp(t, {}, options).app, 'POST', '/api/rooms/room-1/avatar', multipart('avatar', PNG))).status, status);
    assert.equal((await call(routeApp(t, {}, options).app, 'DELETE', '/api/rooms/room-1/avatar')).status, status);
  }
  for (const url of ['/api/auth/avatar', '/api/rooms/room-1/avatar']) {
    const limited = await call(routeApp(t, {}, { limited: true }).app, 'POST', url, multipart('avatar', PNG));
    assert.deepEqual([limited.status, limited.headers['retry-after'], limited.body.error], [429, '8', 'Слишком много загрузок, попробуйте позже']);
  }
  const gone = { status: 'not_found' };
  const app = routeApp(t, { setUserAvatar: gone, clearUserAvatar: gone, setRoomAvatar: gone, clearRoomAvatar: gone }).app;
  assert.deepEqual((await call(app, 'POST', '/api/auth/avatar', multipart('avatar', PNG))).body.error, 'Аккаунт не найден');
  assert.deepEqual((await call(app, 'DELETE', '/api/auth/avatar')).body.error, 'Аккаунт не найден');
  assert.deepEqual((await call(app, 'POST', '/api/rooms/room-1/avatar', multipart('avatar', PNG))).body.error, 'Комната не найдена');
  assert.deepEqual((await call(app, 'DELETE', '/api/rooms/room-1/avatar')).body.error, 'Комната не найдена');
});

test('served images are immutable WebP; missing ones are a JSON 404', async (t) => {
  const { app } = routeApp(t);
  for (const url of ['/api/avatars/some-key', '/api/link-previews/some-key']) {
    const served = await call(app, 'GET', url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(served.headers['content-type'], /^image\/webp/);
    assert.equal(served.body, 'img');
  }
  assert.deepEqual((await call(app, 'GET', '/api/avatars/missing')).body, { ok: false, error: 'Avatar not found' });
  assert.deepEqual((await call(app, 'GET', '/api/link-previews/missing')).body, { ok: false, error: 'Image not found' });
});

test('readAvatarUpload rethrows unexpected multipart failures', async () => {
  await assert.rejects(readAvatarUpload({ file: async () => { throw new Error('boom'); } }), /boom/);
  await assert.rejects(readAvatarUpload({ file: async () => { throw Object.assign(new Error('big'), { code: 'FST_REQ_FILE_TOO_LARGE' }); } }), (error) => error.statusCode === 413);
  await assert.rejects(readAvatarUpload({ file: async () => null }), (error) => error.statusCode === 400);
  const part = (toBuffer, truncated = false) => ({ fieldname: 'avatar', file: { truncated }, toBuffer });
  await assert.rejects(readAvatarUpload({ file: async () => part(async () => Buffer.from('x'), true) }), (error) => error.statusCode === 413);
  await assert.rejects(readAvatarUpload({ file: async () => part(async () => { throw Object.assign(new Error('x'), { statusCode: 413 }); }) }), (error) => error.message === 'Avatar file must be at most 5 MB');
  await assert.rejects(readAvatarUpload({ file: async () => part(async () => { throw new Error('socket'); }) }), /socket/);
});
