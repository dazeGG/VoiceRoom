import fs from 'node:fs';
import path from 'node:path';
import { readUploadsDir } from './config.ts';

const USER_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ROOM_ID_PATTERN = '[abcdefghijkmnpqrstuvwxyz23456789]{10}';
const AVATAR_KEY_PATTERN = new RegExp(`^(?:av_${USER_ID_PATTERN}|room_${ROOM_ID_PATTERN})_[0-9a-f]{8}\\.webp$`);

export type AvatarStorage = {
  save(key: string, buffer: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  createReadStream(key: string): fs.ReadStream;
  listKeys(): Promise<string[]>;
};

function validateAvatarKey(key: unknown): string {
  if (typeof key !== 'string' || !AVATAR_KEY_PATTERN.test(key)) {
    throw new TypeError('Invalid avatar key');
  }
  return key;
}

function createAvatarStorage({ uploadsDir = readUploadsDir() }: { uploadsDir?: string } = {}): AvatarStorage {
  const root = path.resolve(uploadsDir);

  function filePath(key: string): string {
    return path.join(root, validateAvatarKey(key));
  }

  async function save(key: string, buffer: Buffer): Promise<void> {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Avatar contents must be a Buffer');
    }
    const destination = filePath(key);
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(destination, buffer);
  }

  async function remove(key: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath(key));
    } catch (error) {
      if ((error as { code?: unknown } | null | undefined)?.code !== 'ENOENT') throw error;
    }
  }

  function createReadStream(key: string): fs.ReadStream {
    return fs.createReadStream(filePath(key));
  }

  async function listKeys(): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as { code?: unknown } | null | undefined)?.code === 'ENOENT') return [];
      throw error;
    }
    return entries.filter((entry) => entry.isFile() && AVATAR_KEY_PATTERN.test(entry.name)).map((entry) => entry.name);
  }

  return { save, remove, createReadStream, listKeys };
}

export { AVATAR_KEY_PATTERN, validateAvatarKey, createAvatarStorage };
