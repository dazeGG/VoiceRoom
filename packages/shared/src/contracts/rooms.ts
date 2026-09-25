// Rooms over HTTP: create, rename, delete, the public status card, the peer
// preview, the account's room list, and owner moderation of peers. The lobby
// card and the public peer are also what the realtime channel sends.

import { Type, type Static } from 'typebox';
import { Failure, Nullable, Ok } from './http.ts';

/** A room failure; a missing or banned room also names the room it was about. */
export const RoomFailure = Type.Object({
  ...Failure.properties,
  roomId: Type.Optional(Type.String()),
  exists: Type.Optional(Type.Boolean())
});
export type RoomFailure = Static<typeof RoomFailure>;

/** Someone in a room, as everyone else there sees them. */
export const PublicPeer = Type.Object({
  /** The account behind the peer, '' for a guest. */
  accountUserId: Type.String(),
  avatarAccent: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarUrl: Nullable(Type.String()),
  deafened: Type.Optional(Type.Boolean()),
  id: Type.String(),
  joinedAt: Type.Optional(Type.Number()),
  muted: Type.Optional(Type.Boolean()),
  name: Type.Optional(Type.String()),
  screen: Type.Optional(Type.Boolean()),
  /** Muted by the room owner; the participant cannot lift it. */
  serverMuted: Type.Boolean(),
  screenAudio: Type.Optional(Type.Boolean()),
  screenProfileId: Type.Optional(Type.String()),
  screenStreamId: Type.Optional(Type.String()),
  viewedScreenPeerId: Type.Optional(Type.String())
});
export type PublicPeer = Static<typeof PublicPeer>;

/** The lobby card: the rename answer, the room list and the room.updated event. */
export const LobbyRoom = Type.Object({
  avatarUrl: Nullable(Type.String()),
  createdAt: Type.Number(),
  emptySince: Type.Optional(Nullable(Type.Number())),
  isStatic: Type.Boolean(),
  lastMessageAt: Type.Optional(Nullable(Type.Number())),
  name: Type.String(),
  peers: Type.Number(),
  /** How the account holds the room: 'owner', 'bookmarked' or 'member'. */
  relationship: Type.String(),
  roomId: Type.String(),
  unreadCount: Type.Optional(Type.Number())
});
export type LobbyRoom = Static<typeof LobbyRoom>;

export const RoomProof = Type.Object({
  challenge: Type.Optional(Type.String()),
  nonce: Type.Optional(Type.Union([Type.Number(), Type.String()]))
});
export type RoomProof = Static<typeof RoomProof>;

export const CreateRoomBody = Type.Object({
  isStatic: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Number()])),
  name: Type.Optional(Type.String()),
  /** Proof of work when the server asks for one (GET /api/pow-challenge). */
  proof: Type.Optional(Nullable(RoomProof))
});
export type CreateRoomBody = Static<typeof CreateRoomBody>;

export const RoomCreated = Ok({
  avatarUrl: Type.Null(),
  createdAt: Type.Number(),
  maxRooms: Type.Number(),
  maxRoomPeers: Type.Number(),
  isStatic: Type.Boolean(),
  name: Type.String(),
  owned: Type.Boolean(),
  roomId: Type.String()
});
export type RoomCreated = Static<typeof RoomCreated>;

export const RenameRoomBody = Type.Object({ name: Type.Optional(Type.String()) });
export type RenameRoomBody = Static<typeof RenameRoomBody>;

export const RoomCard = Ok({ room: LobbyRoom });
export type RoomCard = Static<typeof RoomCard>;

export const RoomStatus = Ok({
  avatarUrl: Nullable(Type.String()),
  createdAt: Type.Number(),
  exists: Type.Literal(true),
  emptySince: Type.Optional(Nullable(Type.Number())),
  isStatic: Type.Boolean(),
  maxRoomPeers: Type.Number(),
  name: Type.String(),
  peers: Type.Number(),
  roomId: Type.String()
});
export type RoomStatus = Static<typeof RoomStatus>;

export const RoomPeers = Ok({ roomId: Type.String(), peers: Type.Array(PublicPeer) });
export type RoomPeers = Static<typeof RoomPeers>;

/** The legacy /api/state read: a peer proves its session and reads itself back. */
export const PeerStateBody = Type.Object({
  roomId: Type.Optional(Type.String()),
  peerId: Type.Optional(Type.String()),
  sessionToken: Type.Optional(Type.String())
});
export const PeerState = Ok({ peer: PublicPeer });
export type PeerState = Static<typeof PeerState>;

export const RoomList = Ok({ rooms: Type.Array(LobbyRoom) });
export type RoomList = Static<typeof RoomList>;

/** A room code as typed into "add room": any of the three names. */
export const BookmarkRoomBody = Type.Object({
  roomId: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  roomCode: Type.Optional(Type.String())
});
export type BookmarkRoomBody = Static<typeof BookmarkRoomBody>;

export const RoomUnbookmarked = Ok({ removed: Type.Boolean() });
export type RoomUnbookmarked = Static<typeof RoomUnbookmarked>;

export const PeerTargetBody = Type.Object({ peerId: Type.Optional(Type.String()) });
export const ServerMuteBody = Type.Object({
  peerId: Type.Optional(Type.String()),
  muted: Type.Optional(Type.Boolean())
});
export const ServerMuted = Ok({ muted: Type.Boolean() });
export type ServerMuted = Static<typeof ServerMuted>;
export const PeerBanned = Ok({ banId: Type.String() });
export type PeerBanned = Static<typeof PeerBanned>;
export const BanParams = Type.Object({ roomId: Type.String(), banId: Type.String() });
