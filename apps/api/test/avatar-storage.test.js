'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { createAvatarStorage, validateAvatarKey } = require('../src/lib/avatar-storage');

const USER_KEY = 'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp';
const ROOM_KEY = 'room_abcdefghij_0123abcd.webp';

async function readStream(stream) {
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  await once(stream, 'end');
  return Buffer.concat(chunks);
}

test('avatar storage writes, reads, and removes an avatar', async (t) => {
  const uploadsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatar-storage-'));
  t.after(() => fs.promises.rm(uploadsDir, { recursive: true, force: true }));
  const storage = createAvatarStorage({ uploadsDir });
  const contents = Buffer.from('normalized-webp');

  await storage.save(USER_KEY, contents);
  assert.deepEqual(await readStream(storage.createReadStream(USER_KEY)), contents);

  await storage.remove(USER_KEY);
  await assert.rejects(fs.promises.access(path.join(uploadsDir, USER_KEY)), { code: 'ENOENT' });
  await storage.remove(USER_KEY);
});

test('avatar storage creates the uploads directory on first save', async (t) => {
  const parent = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatar-storage-parent-'));
  t.after(() => fs.promises.rm(parent, { recursive: true, force: true }));
  const uploadsDir = path.join(parent, 'nested', 'uploads');
  const storage = createAvatarStorage({ uploadsDir });

  await storage.save(ROOM_KEY, Buffer.from('room-avatar'));

  assert.equal(await fs.promises.readFile(path.join(uploadsDir, ROOM_KEY), 'utf8'), 'room-avatar');
});

test('avatar storage rejects traversal, absolute paths, and malformed keys', async () => {
  for (const key of [
    '../' + USER_KEY,
    '/tmp/' + USER_KEY,
    'av_user_deadbeef.webp',
    'room_abcdefghij_deadbeef.png',
    'room_abcdefghij_deadbeef.webp/extra',
    '',
    null
  ]) {
    assert.throws(() => validateAvatarKey(key), /Invalid avatar key/);
  }
});

test('avatar storage requires Buffer contents', async (t) => {
  const uploadsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatar-storage-'));
  t.after(() => fs.promises.rm(uploadsDir, { recursive: true, force: true }));

  await assert.rejects(createAvatarStorage({ uploadsDir }).save(USER_KEY, 'not-a-buffer'), /must be a Buffer/);
});
