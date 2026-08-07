'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaStorage, createStorageKey, parseStorageKey } = require('../src/domains/media/storage');
const ID = '123e4567-e89b-42d3-a456-426614174000';

test('G74-A01 private storage atomically streams variants and removes idempotently', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-media-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  const saved = await storage.save(ID, 'original', [Buffer.from('one'), Buffer.from('two')], { maxBytes: 6 });
  assert.deepEqual(saved, { key: `${ID}/original`, bytes: 6 });
  const opened = await storage.openRead(ID, 'original');
  assert.equal(opened.bytes, 6);
  for await (const ignored of opened.stream) void ignored;
  assert.deepEqual(await storage.listKeys(), [`${ID}/original`]);
  assert.ok((await storage.freeSpace()).availableBytes > 0n);
  assert.equal(await storage.remove(ID, 'original'), true);
  assert.equal(await storage.remove(ID, 'original'), false);
});

test('G74-A02 traversal, encoded paths, symlinks, foreign objects and interrupted writes fail closed', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-media-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storage = createMediaStorage({ rootDir: root });
  for (const value of ['../x', '%2e%2e/x', `${ID}/../original`, 'avatars/user.webp']) assert.throws(() => parseStorageKey(value));
  assert.throws(() => createStorageKey(ID, 'other'));
  await assert.rejects(storage.save(ID, 'original', Buffer.alloc(2), { maxBytes: 1 }), (error) => error.code === 'MEDIA_TOO_LARGE');
  const attachmentDir = path.join(root, ID);
  assert.deepEqual(await fs.promises.readdir(attachmentDir), []);
  const target = path.join(root, 'target'); await fs.promises.mkdir(target);
  const symlinkId = '223e4567-e89b-42d3-a456-426614174000';
  try {
    await fs.promises.symlink(target, path.join(root, symlinkId), 'junction');
    await assert.rejects(storage.save(symlinkId, 'preview', Buffer.from('x')), /symbolic link|escaped/);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }
  await fs.promises.writeFile(path.join(root, 'foreign'), 'x');
  await assert.rejects(storage.listKeys(), /foreign object|invalid attachment directory/);
});
