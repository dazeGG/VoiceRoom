// What clients see of a room and of the peers in it. The web client mirrors
// these shapes (apps/web/src/lib/api/rooms.ts), and the realtime runtime sends
// the same objects over the socket, so a field changes here or nowhere.

import { avatarColorForPeerId } from '../../lib/room-store.ts';
import { failure, type Failure } from '../../platform/http/http-kit.ts';

/** A peer as the in-memory presence roster holds it. */
export interface PresencePeer {
  id: string;
  accountUserId?: string | null;
  avatarAccent?: string | null;
  avatarColorKey?: string | null;
  avatarUrl?: string | null;
  deafened?: boolean;
  gateGuestPrincipalId?: string | null;
  ip?: string;
  joinedAt?: number;
  muted?: boolean;
  name?: string;
  screen?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  serverMuted?: boolean;
  sessionToken?: string;
  transport?: { id?: string; send(message: unknown): boolean } | null;
  viewedScreenPeerId?: string;
}

/** A room row as the store returns it. */
export interface StoredRoom {
  id: string;
  avatarKey?: string | null;
  createdAt: number;
  emptySince?: number | null;
  isStatic: boolean;
  lastMessageAt?: number | null;
  name: string;
  ownerId?: string | null;
  relationship?: string;
  unreadCount?: number;
}

/** A stored room joined with its live presence roster. */
export interface LiveRoom extends StoredRoom {
  peers: Map<string, PresencePeer>;
  /** Stamped when the room is read (server.ts getRoom). */
  updatedAt: number;
}

export function roomAvatarUrl(avatarKey: string | null | undefined): string | null {
  return avatarKey ? `/api/avatars/${encodeURIComponent(avatarKey)}` : null;
}

export function publicPeer(peer: PresencePeer) {
  return {
    accountUserId: peer.accountUserId || '',
    avatarAccent: peer.avatarAccent || null,
    avatarColorKey: peer.avatarColorKey || (avatarColorForPeerId(peer.id) as string),
    avatarUrl: peer.avatarUrl || null,
    deafened: peer.deafened,
    id: peer.id,
    joinedAt: peer.joinedAt,
    muted: peer.muted,
    name: peer.name,
    screen: peer.screen,
    serverMuted: Boolean(peer.serverMuted),
    screenAudio: peer.screenAudio,
    screenProfileId: peer.screenProfileId,
    screenStreamId: peer.screenStreamId,
    viewedScreenPeerId: peer.viewedScreenPeerId
  };
}

export type PublicPeer = ReturnType<typeof publicPeer>;

export interface LobbyRoom {
  avatarUrl: string | null;
  createdAt: number;
  emptySince: number | null | undefined;
  isStatic: boolean;
  lastMessageAt?: number | null;
  name: string;
  peers: number;
  relationship: string;
  roomId: string;
  unreadCount?: number;
}

/** The lobby card: the PUT response, the room list and the room.updated event. */
export function publicLobbyRoom(room: StoredRoom, peerCount: number): LobbyRoom {
  const result: LobbyRoom = {
    avatarUrl: roomAvatarUrl(room.avatarKey),
    createdAt: room.createdAt,
    emptySince: room.emptySince,
    isStatic: room.isStatic,
    name: room.name,
    peers: peerCount,
    relationship: room.relationship || 'owner',
    roomId: room.id
  };
  if (room.lastMessageAt !== undefined) result.lastMessageAt = room.lastMessageAt;
  if (Number.isFinite(room.unreadCount)) result.unreadCount = Math.max(0, room.unreadCount as number);
  return result;
}

export const ROOM_BANNED_ERROR = 'Вы заблокированы в этой комнате';

export function roomBanned(roomId: string): Failure & { roomId: string } {
  return { ...failure(ROOM_BANNED_ERROR, { code: 'room_banned' }), roomId };
}
