'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const {
  AVATAR_SIZE,
  createAvatarKey,
  detectAvatarFormat,
  processAvatar
} = require('../src/lib/avatar-processing');

test('avatar processing accepts JPEG, PNG, and WebP magic bytes and normalizes to 256px WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 230, g: 40, b: 90 } }
    })[format]().toBuffer();
    assert.equal(detectAvatarFormat(input), format);

    const processed = await processAvatar(input);
    const metadata = await sharp(processed.buffer).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, AVATAR_SIZE);
    assert.equal(metadata.height, AVATAR_SIZE);
    assert.match(processed.hash, /^[0-9a-f]{8}$/);
    assert.match(processed.accent, /^#[0-9a-f]{6}$/i);
  }
});

test('avatar processing rejects unsupported, empty, and unsafe image contents', async () => {
  assert.equal(detectAvatarFormat(Buffer.from('GIF89a')), '');
  await assert.rejects(processAvatar(Buffer.from('GIF89a')), { statusCode: 415 });
  await assert.rejects(processAvatar(Buffer.alloc(0)), { statusCode: 413 });

  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  await assert.rejects(processAvatar(fakePng), { statusCode: 400 });
});

test('avatar keys use server-controlled kinds, ids, and content hashes', () => {
  assert.equal(
    createAvatarKey('user', '123e4567-e89b-12d3-a456-426614174000', 'deadbeef'),
    'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp'
  );
  assert.equal(createAvatarKey('room', 'abcdefghij', '0123abcd'), 'room_abcdefghij_0123abcd.webp');
  assert.throws(() => createAvatarKey('room', '', '0123abcd'), /Invalid avatar key input/);
  assert.throws(() => createAvatarKey('user', 'id', '../bad'), /Invalid avatar key input/);
});
