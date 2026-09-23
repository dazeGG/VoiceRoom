import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LINK_PREVIEW_IMAGE_KEY_PATTERN } from '@voice-room/shared/link-preview';
import { readUploadsDir } from './config.js';

// Preview images live next to avatars, in their own folder so neither kind of
// reconciliation ever sees the other's files. A key is the content hash of the
// stored image, so two links with the same picture share one file.

function validateLinkPreviewImageKey(key) {
  if (typeof key !== 'string' || !LINK_PREVIEW_IMAGE_KEY_PATTERN.test(key)) {
    throw new TypeError('Invalid link preview image key');
  }
  return key;
}

function createLinkPreviewStorage({ uploadsDir = readUploadsDir() } = {}) {
  const root = path.join(path.resolve(uploadsDir), 'link-previews');

  function filePath(key) {
    return path.join(root, validateLinkPreviewImageKey(key));
  }

  async function save(key, buffer) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('Link preview image contents must be a Buffer');
    const destination = filePath(key);
    await fs.promises.mkdir(root, { recursive: true });
    const temporary = path.join(root, `.${key}.${crypto.randomUUID()}.tmp`);
    await fs.promises.writeFile(temporary, buffer);
    await fs.promises.rename(temporary, destination);
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
      .filter((entry) => entry.isFile() && LINK_PREVIEW_IMAGE_KEY_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  return { save, remove, createReadStream, listKeys };
}

// Removes stored images that neither a cached preview nor any message uses.
async function reconcileLinkPreviewImages({ storage, repository }) {
  const [storedKeys, referencedKeys] = await Promise.all([storage.listKeys(), repository.listReferencedImageKeys()]);
  const referenced = new Set(referencedKeys);
  const unused = storedKeys.filter((key) => !referenced.has(key));
  for (const key of unused) await storage.remove(key);
  return unused.length;
}

export { createLinkPreviewStorage, reconcileLinkPreviewImages, validateLinkPreviewImageKey };
