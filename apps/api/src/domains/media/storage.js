'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VARIANTS = new Set(['original', 'processed', 'preview']);
const STORAGE_KEY_PATTERN = new RegExp(`^(${UUID_PATTERN.source.slice(1, -1)})/(original|processed|preview)$`);
const TEMPORARY_FILE_PATTERN = /^\.(original|processed|preview)\.[0-9a-f-]{36}\.tmp$/;

function validateAttachmentId(value) {
  const id = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID_PATTERN.test(id)) throw new TypeError('Invalid media attachment id');
  return id;
}

function validateVariant(value) {
  if (!VARIANTS.has(value)) throw new TypeError('Invalid media variant');
  return value;
}

function createStorageKey(attachmentId, variant) {
  return `${validateAttachmentId(attachmentId)}/${validateVariant(variant)}`;
}

function parseStorageKey(value) {
  const match = typeof value === 'string' ? STORAGE_KEY_PATTERN.exec(value) : null;
  if (!match) throw new TypeError('Invalid media storage key');
  return Object.freeze({ attachmentId: match[1], variant: match[2] });
}

function contentChunks(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return [source];
  if (source && typeof source[Symbol.asyncIterator] === 'function') return source;
  if (source && typeof source[Symbol.iterator] === 'function') return source;
  throw new TypeError('Media contents must be a Buffer, Uint8Array, or iterable stream');
}

function createMediaStorage({ rootDir, mediaDir } = {}) {
  const configuredRoot = rootDir || mediaDir;
  if (typeof configuredRoot !== 'string' || !configuredRoot.trim()) {
    throw new TypeError('A private media storage directory is required');
  }
  const root = path.resolve(configuredRoot);
  let canonicalRoot = null;

  async function assertDirectory(directory, expectedRealPath) {
    const stat = await fs.promises.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Private media namespace contains a non-directory or symbolic link');
    }
    const realPath = await fs.promises.realpath(directory);
    if (realPath !== expectedRealPath) throw new Error('Private media namespace escaped its configured path');
  }

  async function ensureRoot() {
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.promises.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Private media root must be a real directory');
    }
    const realPath = await fs.promises.realpath(root);
    if (canonicalRoot && canonicalRoot !== realPath) {
      throw new Error('Private media root changed while the process was running');
    }
    canonicalRoot = realPath;
    await fs.promises.chmod(root, 0o700);
    return root;
  }

  async function ensureAttachmentDirectory(attachmentId) {
    const id = validateAttachmentId(attachmentId);
    await ensureRoot();
    const directory = path.join(root, id);
    await fs.promises.mkdir(directory, { mode: 0o700 });
    await assertDirectory(directory, path.join(canonicalRoot, id));
    await fs.promises.chmod(directory, 0o700);
    return directory;
  }

  async function existingAttachmentDirectory(attachmentId) {
    const id = validateAttachmentId(attachmentId);
    await ensureRoot();
    const directory = path.join(root, id);
    try {
      await assertDirectory(directory, path.join(canonicalRoot, id));
      return directory;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function syncDirectory(directory) {
    let handle;
    try {
      handle = await fs.promises.open(directory, fs.constants.O_RDONLY);
      await handle.sync();
    } finally {
      await handle?.close();
    }
  }

  async function save(attachmentId, variant, source, { maxBytes = Infinity } = {}) {
    const id = validateAttachmentId(attachmentId);
    const normalizedVariant = validateVariant(variant);
    const directory = await ensureAttachmentDirectory(id);
    const destination = path.join(directory, normalizedVariant);
    const temporary = path.join(directory, `.${normalizedVariant}.${crypto.randomUUID()}.tmp`);
    const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW || 0);
    let handle;
    let bytes = 0;
    try {
      handle = await fs.promises.open(temporary, flags, 0o600);
      for await (const value of contentChunks(source)) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        bytes += chunk.length;
        if (bytes > maxBytes) {
          const error = new Error('Media contents exceed the allowed size');
          error.code = 'MEDIA_TOO_LARGE';
          throw error;
        }
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset);
          offset += result.bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(temporary, destination);
      await fs.promises.chmod(destination, 0o600);
      await syncDirectory(directory);
      return Object.freeze({ key: createStorageKey(id, normalizedVariant), bytes });
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.promises.unlink(temporary).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
      throw error;
    }
  }

  async function openRead(attachmentId, variant) {
    const directory = await existingAttachmentDirectory(attachmentId);
    if (!directory) {
      const error = new Error('Media object does not exist');
      error.code = 'ENOENT';
      throw error;
    }
    const file = path.join(directory, validateVariant(variant));
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Media object is not a regular file');
      return Object.freeze({
        key: createStorageKey(attachmentId, variant),
        bytes: stat.size,
        stream: handle.createReadStream({ autoClose: true })
      });
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  async function createReadStream(attachmentId, variant) {
    return (await openRead(attachmentId, variant)).stream;
  }

  async function remove(attachmentId, variant) {
    const directory = await existingAttachmentDirectory(attachmentId);
    if (!directory) return false;
    const file = path.join(directory, validateVariant(variant));
    try {
      const stat = await fs.promises.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Refusing to remove a foreign media object');
      await fs.promises.unlink(file);
      await syncDirectory(directory);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function removeAttachment(attachmentId) {
    const directory = await existingAttachmentDirectory(attachmentId);
    if (!directory) return false;
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const managedName = VARIANTS.has(entry.name) || TEMPORARY_FILE_PATTERN.test(entry.name);
      if (!managedName || !entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Refusing to remove a media namespace containing foreign objects');
      }
    }
    await Promise.all(entries.map((entry) => fs.promises.unlink(path.join(directory, entry.name))));
    await fs.promises.rmdir(directory);
    await syncDirectory(root);
    return true;
  }

  async function listKeys() {
    await ensureRoot();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const keys = [];
    for (const entry of entries) {
      if (!UUID_PATTERN.test(entry.name)) {
        throw new Error('Private media namespace contains a foreign object');
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error('Private media namespace contains an invalid attachment directory');
      }
      const directory = await existingAttachmentDirectory(entry.name);
      const variants = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const variant of variants) {
        if (VARIANTS.has(variant.name) && variant.isFile() && !variant.isSymbolicLink()) {
          keys.push(createStorageKey(entry.name, variant.name));
        } else if (!TEMPORARY_FILE_PATTERN.test(variant.name) || !variant.isFile() || variant.isSymbolicLink()) {
          throw new Error('Private media attachment namespace contains a foreign object');
        }
      }
    }
    return keys.sort();
  }

  async function freeSpace() {
    await ensureRoot();
    const stats = await fs.promises.statfs(root, { bigint: true });
    return Object.freeze({
      availableBytes: stats.bavail * stats.bsize,
      freeBytes: stats.bfree * stats.bsize,
      totalBytes: stats.blocks * stats.bsize
    });
  }

  async function removeStaleTemporaryFiles(before, { limit = 500 } = {}) {
    await ensureRoot();
    const cutoff = before instanceof Date ? before.getTime() : Number(before);
    if (!Number.isFinite(cutoff)) throw new TypeError('A temporary media cutoff is required');
    const removed = [];
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (removed.length >= Math.max(1, Math.min(Number(limit) || 500, 500))) break;
      if (!UUID_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const directory = await existingAttachmentDirectory(entry.name);
      const variants = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const variant of variants) {
        if (removed.length >= limit) break;
        if (!TEMPORARY_FILE_PATTERN.test(variant.name) || !variant.isFile() || variant.isSymbolicLink()) continue;
        const file = path.join(directory, variant.name);
        const stat = await fs.promises.lstat(file);
        if (stat.mtimeMs > cutoff) continue;
        await fs.promises.unlink(file);
        removed.push(`${entry.name}/${variant.name}`);
      }
      if (removed.length) await syncDirectory(directory);
    }
    return removed;
  }

  return Object.freeze({
    createReadStream,
    createStorageKey,
    freeSpace,
    listKeys,
    openRead,
    parseStorageKey,
    remove,
    removeAttachment,
    removeStaleTemporaryFiles,
    root,
    save
  });
}

module.exports = {
  STORAGE_KEY_PATTERN,
  UUID_PATTERN,
  createMediaStorage,
  createStorageKey,
  parseStorageKey,
  validateAttachmentId,
  validateVariant
};
