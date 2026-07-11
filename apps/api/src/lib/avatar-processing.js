'use strict';

const crypto = require('node:crypto');
const sharp = require('sharp');
const { deriveAvatarAccent } = require('@voice-room/shared/avatar-accent');

const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024;

function detectAvatarFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

async function processAvatar(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
    const error = new Error('Avatar file must be at most 5 MB');
    error.statusCode = 413;
    throw error;
  }
  if (!detectAvatarFormat(buffer)) {
    const error = new Error('Only JPEG, PNG, and WebP images are supported');
    error.statusCode = 415;
    throw error;
  }

  let output;
  try {
    output = await sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
  } catch (cause) {
    const error = new Error('Invalid or unsafe image');
    error.statusCode = 400;
    error.cause = cause;
    throw error;
  }

  const { dominant } = await sharp(output).stats();
  const presentation = deriveAvatarAccent(dominant);
  return {
    accent: presentation.background,
    buffer: output,
    hash: crypto.createHash('sha256').update(output).digest('hex').slice(0, 8)
  };
}

function createAvatarKey(kind, id, hash) {
  const normalizedId = String(id || '');
  const validId = kind === 'user'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedId)
    : kind === 'room' && /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/.test(normalizedId);
  if (!validId || !/^[a-f0-9]{8}$/.test(hash)) throw new Error('Invalid avatar key input');
  return `${kind === 'room' ? 'room' : 'av'}_${normalizedId}_${hash}.webp`;
}

module.exports = {
  AVATAR_SIZE,
  MAX_AVATAR_BYTES,
  createAvatarKey,
  detectAvatarFormat,
  processAvatar
};
