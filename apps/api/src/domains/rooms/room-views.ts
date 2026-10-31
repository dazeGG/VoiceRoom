// What clients see of a room and of the peers in it: the shapes of
// @voice-room/shared/contracts/rooms, which the HTTP routes register and the
// realtime runtime sends over the socket.

import type { LobbyRoom, PublicPeer, RoomRelationship } from '@voice-room/shared/contracts/rooms';
import type { ClientKind } from '@voice-room/shared/contracts/admin';
import { avatarUrl } from '../../lib/avatar-url.ts';
import { avatarColorForPeerId } from './avatar-color.ts';
import { failure, type Failure } from '../../platform/http/http-kit.ts';
import type { WsConnection } from '../../realtime/registry.ts';
import type { PeerVoice } from '../../realtime/voice-track.ts';

/** A peer as the in-memory presence roster holds it. */
export interface PresencePeer {
  id: string;
  accountUserId?: string | null;
  avatarAccent?: string | null;
  avatarColorKey?: string | null | undefined;
  avatarUrl?: string | null;
  camera?: boolean;
  /** The desktop app, a phone or a browser, from the socket that took the seat. */
  client?: ClientKind | null;
  /** The system and browser of that socket; see WsConnection.device. */
  os?: string | undefined;
  browser?: string | undefined;
  /** A guest's lasting browser id (normalizeGuestId); empty for an account. */
  guestId?: string | undefined;
  deafened?: boolean;
  gateGuestPrincipalId?: string | null;
  ip?: string | undefined;
  joinedAt?: number;
  /** Granted media that has not shown up in presence yet; see realtime/media-budget.ts. */
  mediaClaims?: { screen?: { profileId: string; expiresAt: number }; camera?: { expiresAt: number } } | undefined;
  muted?: boolean;
  name?: string;
  screen?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  serverMuted?: boolean;
  sessionToken?: string;
  /**
   * The join that holds the seat (only it may close the seat) and the socket
   * the seat reaches; the socket is null while a reconnect lease holds the seat.
   */
  transport?: { id: string; connection: WsConnection | null } | null;
  viewedScreenPeerId?: string;
  /** The stay's voice as the room's stats polls tell it (realtime/voice-track.ts). */
  voice?: PeerVoice | undefined;
}

/** A room row as the store returns it. */
export interface StoredRoom {
  id: string;
  avatarKey?: string | null;
  createdAt: number;
  emptySince?: number | null;
  isStatic: boolean;
  lastMessageAt?: number | null | undefined;
  name: string;
  ownerId?: string | null;
  /** Absent when the listing did not say; the card then shows 'member'. */
  relationship?: RoomRelationship;
  unreadCount?: number | undefined;
}

/** A stored room joined with its live presence roster. */
export interface LiveRoom extends StoredRoom {
  peers: Map<string, PresencePeer>;
  /** Stamped when the room is read (server.ts getRoom). */
  updatedAt: number;
}

export function publicPeer(peer: PresencePeer): PublicPeer {
  const result: PublicPeer = {
    accountUserId: peer.accountUserId || '',
    avatarAccent: peer.avatarAccent || null,
    avatarColorKey: peer.avatarColorKey || avatarColorForPeerId(peer.id),
    avatarUrl: peer.avatarUrl || null,
    id: peer.id,
    serverMuted: Boolean(peer.serverMuted)
  };
  if (peer.deafened !== undefined) result.deafened = peer.deafened;
  if (peer.joinedAt !== undefined) result.joinedAt = peer.joinedAt;
  if (peer.muted !== undefined) result.muted = peer.muted;
  if (peer.name !== undefined) result.name = peer.name;
  if (peer.screen !== undefined) result.screen = peer.screen;
  if (peer.screenAudio !== undefined) result.screenAudio = peer.screenAudio;
  if (peer.screenProfileId !== undefined) result.screenProfileId = peer.screenProfileId;
  if (peer.screenStreamId !== undefined) result.screenStreamId = peer.screenStreamId;
  if (peer.viewedScreenPeerId !== undefined) result.viewedScreenPeerId = peer.viewedScreenPeerId;
  return result;
}

export type { LobbyRoom, PublicPeer };

/** The lobby card: the PUT response, the room list and the room.updated event. */
export function publicLobbyRoom(room: StoredRoom, peerCount: number): LobbyRoom {
  const result: LobbyRoom = {
    avatarUrl: avatarUrl(room.avatarKey),
    createdAt: room.createdAt,
    isStatic: room.isStatic,
    name: room.name,
    peers: peerCount,
    relationship: room.relationship ?? 'member',
    roomId: room.id
  };
  if (room.emptySince !== undefined) result.emptySince = room.emptySince;
  if (room.lastMessageAt !== undefined) result.lastMessageAt = room.lastMessageAt;
  const unread = room.unreadCount;
  if (typeof unread === 'number' && Number.isFinite(unread)) result.unreadCount = Math.max(0, unread);
  return result;
}

const ROOM_BANNED_ERROR = 'Вы заблокированы в этой комнате';

export function roomBanned(roomId: string): Failure & { roomId: string } {
  return { ...failure(ROOM_BANNED_ERROR, { code: 'room_banned' }), roomId };
}
