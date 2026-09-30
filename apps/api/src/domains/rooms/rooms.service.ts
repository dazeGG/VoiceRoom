// Creating, renaming and deleting rooms, and the owner check every room
// mutation starts with. Quotas are enforced by the store inside the insert.

import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { LiveRoom, LobbyRoom, StoredRoom } from './room-views.ts';
import { isRoomOwner } from './room.policy.ts';

type RequestLog = { log?: Pick<Logger, 'warn' | 'error'> } | null;

const ROOM_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function createRoomId(): string {
  return Array.from(crypto.randomBytes(10), (byte) => ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length]).join('');
}

export type CreateRoomResult =
  { status: 'created'; room: StoredRoom } | { status: 'auth_required' | 'quota_exceeded' | 'capacity_exceeded' };

export interface RoomsStore {
  roomIdExists?(roomId: string): Promise<boolean>;
  getRoom(roomId: string): Promise<StoredRoom | null>;
  createRoomWithQuota(input: {
    creatorIp: string;
    isStatic: boolean;
    ownerId: string | null;
    name: string;
    maxOwnedStaticRoomsPerUser: number;
    maxRooms: number;
    maxTempRoomsPerIp: number;
    roomId: string;
  }): Promise<CreateRoomResult>;
  updateRoom(roomId: string, patch: { name: string }): Promise<StoredRoom | null>;
  deleteRoom(roomId: string): Promise<{ avatarKey?: string | null } | null>;
}

export interface RoomLimits {
  maxRooms: number;
  maxOwnedStaticRoomsPerUser: number;
  maxTempRoomsPerIp: number;
}

export interface RoomsServiceDeps {
  store(): RoomsStore;
  /** The stored room joined with its live roster, or null. */
  getRoom(roomId: string): Promise<LiveRoom | null>;
  limits: RoomLimits;
  /** Broadcasts room.updated and returns the lobby card it sent. */
  announceRoomUpdate(roomId: string, room: StoredRoom): LobbyRoom;
  /** Everything after the durable soft-delete: events, invitations, peers, avatar. */
  finishRoomDeletion(roomId: string, options: { avatarKey: string | null; request: RequestLog }): Promise<void>;
  newRoomId?: () => string;
}

export type OwnerCheck =
  { status: 'owner'; room: LiveRoom } | { status: 'unauthenticated' | 'not_found' | 'forbidden' };

export function createRoomsService(deps: RoomsServiceDeps) {
  const newRoomId = deps.newRoomId || createRoomId;

  async function isTaken(roomId: string): Promise<boolean> {
    const store = deps.store();
    return store.roomIdExists ? store.roomIdExists(roomId) : Boolean(await store.getRoom(roomId));
  }

  async function createRoom(input: {
    creatorIp: string;
    isStatic: boolean;
    ownerId: string | null;
    name: string;
  }): Promise<CreateRoomResult> {
    let roomId = newRoomId();
    while (await isTaken(roomId)) roomId = newRoomId();
    return deps.store().createRoomWithQuota({
      ...input,
      maxOwnedStaticRoomsPerUser: deps.limits.maxOwnedStaticRoomsPerUser,
      maxRooms: deps.limits.maxRooms,
      maxTempRoomsPerIp: deps.limits.maxTempRoomsPerIp,
      roomId
    });
  }

  // Only a persistent room has an owner; temporary rooms cannot be changed.
  async function checkOwner(userId: string | null | undefined, roomId: string): Promise<OwnerCheck> {
    if (!userId) return { status: 'unauthenticated' };
    const room = await deps.getRoom(roomId);
    if (!room) return { status: 'not_found' };
    if (!isRoomOwner(room, userId)) return { status: 'forbidden' };
    return { status: 'owner', room };
  }

  // Legacy visual fields are ignored; only the name is mutable.
  async function rename(
    roomId: string,
    name: string
  ): Promise<{ status: 'renamed'; room: LobbyRoom } | { status: 'not_found' }> {
    const updated = await deps.store().updateRoom(roomId, { name });
    // Lost a race with a concurrent delete (UPDATE matched 0 rows).
    if (!updated) return { status: 'not_found' };
    return { status: 'renamed', room: deps.announceRoomUpdate(roomId, updated) };
  }

  async function remove(roomId: string, request: RequestLog): Promise<{ status: 'deleted' | 'not_found' }> {
    const deleted = await deps.store().deleteRoom(roomId);
    if (!deleted) return { status: 'not_found' };
    await deps.finishRoomDeletion(roomId, { avatarKey: deleted.avatarKey ?? null, request });
    return { status: 'deleted' };
  }

  return { createRoom, checkOwner, rename, remove };
}

export type RoomsService = ReturnType<typeof createRoomsService>;
