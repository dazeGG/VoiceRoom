'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readUploadsDir } = require('./config');

const USER_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ROOM_ID_PATTERN = '[abcdefghijkmnpqrstuvwxyz23456789]{10}';
const AVATAR_KEY_PATTERN = new RegExp(
  `^(?:av_${USER_ID_PATTERN}|room_${ROOM_ID_PATTERN})_[0-9a-f]{8}\\.webp$`
);

function validateAvatarKey(key) {
  if (typeof key !== 'string' || !AVATAR_KEY_PATTERN.test(key)) {
    throw new TypeError('Invalid avatar key');
  }
  return key;
}

function createAvatarStorage({ uploadsDir = readUploadsDir() } = {}) {
  const root = path.resolve(uploadsDir);

  function filePath(key) {
    return path.join(root, validateAvatarKey(key));
  }

  async function save(key, buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Avatar contents must be a Buffer');
    }
    const destination = filePath(key);
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(destination, buffer);
  }

  async function remove(key) {
    try {
      await fs.promises.unlink(filePath(key));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  function createReadStream(key) {
    return fs.createReadStream(filePath(key));
  }

  async function listKeys() {
    let entries;
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile() && AVATAR_KEY_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  return { save, remove, createReadStream, listKeys };
}

module.exports = { AVATAR_KEY_PATTERN, validateAvatarKey, createAvatarStorage };
