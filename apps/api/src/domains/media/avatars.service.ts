// Account and room avatars: processing an upload into a content-addressed
// WebP file, swapping it in, telling whoever shows it, and removing the file
// it replaced. Also opens stored avatars and link-preview images for serving.

import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import { createAvatarKey, processAvatar } from '../../lib/avatar-processing.ts';
import { validateAvatarKey } from '../../lib/avatar-storage.ts';
import { selfUser } from '../../lib/user-store.ts';
import type { StoredRoom } from '../rooms/room-views.ts';

type Log = Pick<Logger, 'error'> | undefined;

interface FileStorage {
  createReadStream(key: string): Readable;
}

export interface AvatarStorage extends FileStorage {
  save(key: string, buffer: Buffer): Promise<unknown>;
  remove(key: string): Promise<unknown>;
}

export interface AvatarUser {
  id: string;
  avatarKey?: string | null;
  [key: string]: unknown;
}

export interface AvatarsDeps {
  storage(): AvatarStorage;
  linkPreviewStorage(): FileStorage;
  users(): {
    swapAvatar(input: {
      userId: string;
      avatarKey?: string;
      avatarAccent?: string | null;
    }): Promise<{ user?: AvatarUser | null; previousAvatarKey?: string | null }>;
  };
  rooms(): {
    swapRoomAvatar(
      roomId: string,
      avatarKey: string | null
    ): Promise<{ room?: StoredRoom | null; previousAvatarKey?: string | null }>;
  };
  /** Refreshes the user's live room peers after a profile change. */
  refreshActiveProfile(user: AvatarUser): void;
  broadcastProfileToFriends(user: AvatarUser, log: Log): Promise<void>;
  /** Broadcasts room.updated and returns the lobby card it sent. */
  announceRoomUpdate(roomId: string, room: StoredRoom): unknown;
}

type Updated<T> = { status: 'updated' } & T;
type NotFound = { status: 'not_found' };

/** Resolves once the file is open, so a missing file is a 404 instead of a broken stream. */
async function openFile(storage: FileStorage, key: string): Promise<Readable | null> {
  let stream: Readable;
  try {
    stream = storage.createReadStream(key);
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
  } catch (error) {
    if (error instanceof TypeError || (error as { code?: string })?.code === 'ENOENT') return null;
    throw error;
  }
  return stream;
}

export function createAvatarsService(deps: AvatarsDeps) {
  // Best effort: a file left behind is reconciled later, a failed request is worse.
  async function removeFile(key: string | null | undefined, log: Log): Promise<void> {
    if (!key) return;
    try {
      await deps.storage().remove(key);
    } catch (error) {
      log?.error({ err: error, avatarKey: key }, 'failed to remove old avatar');
    }
  }

  async function store(kind: 'user' | 'room', ownerId: string, upload: Buffer) {
    const processed = await processAvatar(upload);
    const avatarKey: string = createAvatarKey(kind, ownerId, processed.hash);
    await deps.storage().save(avatarKey, processed.buffer);
    return { avatarKey, accent: processed.accent };
  }

  async function profileChanged(user: AvatarUser, log: Log) {
    deps.refreshActiveProfile(user);
    await deps.broadcastProfileToFriends(user, log);
    return { status: 'updated' as const, user: selfUser(user) };
  }

  async function setUserAvatar(
    user: AvatarUser,
    upload: Buffer,
    log: Log
  ): Promise<Updated<{ user: unknown }> | NotFound> {
    const { avatarKey, accent } = await store('user', user.id, upload);
    const result = await deps.users().swapAvatar({ userId: user.id, avatarKey, avatarAccent: accent });
    if (!result.user) {
      // The same content-addressed file may already be the account's avatar.
      if (user.avatarKey !== avatarKey) await removeFile(avatarKey, log);
      return { status: 'not_found' };
    }
    if (result.previousAvatarKey !== avatarKey) await removeFile(result.previousAvatarKey, log);
    return profileChanged(result.user, log);
  }

  async function clearUserAvatar(userId: string, log: Log): Promise<Updated<{ user: unknown }> | NotFound> {
    const result = await deps.users().swapAvatar({ userId });
    if (!result.user) return { status: 'not_found' };
    await removeFile(result.previousAvatarKey, log);
    return profileChanged(result.user, log);
  }

  async function setRoomAvatar(
    room: { id: string; avatarKey?: string | null },
    upload: Buffer,
    log: Log
  ): Promise<Updated<{ room: unknown }> | NotFound> {
    const { avatarKey } = await store('room', room.id, upload);
    const result = await deps.rooms().swapRoomAvatar(room.id, avatarKey);
    if (!result.room) {
      if (room.avatarKey !== avatarKey) await removeFile(avatarKey, log);
      return { status: 'not_found' };
    }
    if (result.previousAvatarKey !== avatarKey) await removeFile(result.previousAvatarKey, log);
    return { status: 'updated', room: deps.announceRoomUpdate(room.id, result.room) };
  }

  async function clearRoomAvatar(roomId: string, log: Log): Promise<Updated<{ room: unknown }> | NotFound> {
    const result = await deps.rooms().swapRoomAvatar(roomId, null);
    if (!result.room) return { status: 'not_found' };
    await removeFile(result.previousAvatarKey, log);
    return { status: 'updated', room: deps.announceRoomUpdate(roomId, result.room) };
  }

  async function openAvatar(key: string): Promise<Readable | null> {
    try {
      validateAvatarKey(key);
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
    return openFile(deps.storage(), key);
  }

  return {
    setUserAvatar,
    clearUserAvatar,
    setRoomAvatar,
    clearRoomAvatar,
    openAvatar,
    openLinkPreviewImage: (key: string) => openFile(deps.linkPreviewStorage(), key),
    removeFile
  };
}

export type AvatarsService = ReturnType<typeof createAvatarsService>;
