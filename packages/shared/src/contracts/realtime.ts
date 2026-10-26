// The realtime (WebSocket /api/ws) protocol: every command a client may send
// and every event the server pushes, each with the TypeBox schema of its
// payload. The API checks each command against its schema before handling it
// (realtime.ts validateClientCommand) and builds events only through
// buildServerEnvelope; the web checks each frame it receives against its
// schema (parseServerFrame) before it switches over ServerEvent. A frame is
// `{ id?, type, payload }`, and a refusal is the `error` frame.

import { Type, type Static, type TSchema } from 'typebox';
import { LoginAlert } from './account.ts';
import { AdminReportsEvent } from './admin.ts';
import { Nullable } from './http.ts';
import { DirectMessage, PinnedMessage, ReactionSummary, RoomMessage } from './messages.ts';
import { NotificationPreferences } from './notifications.ts';
import { LobbyRoom, NetworkLevel, PublicPeer, RoomRelationship } from './rooms.ts';
import { PublicUser } from './users.ts';

/** The room or direct conversation a message belongs to. */
export const ConversationRef = Type.Object({
  type: Type.Union([Type.Literal('room'), Type.Literal('dm')]),
  id: Type.String()
});
export type ConversationRef = Static<typeof ConversationRef>;

/** A frame of one type: its optional request id, its type and its payload. */
function Frame<const Type extends string, Payload extends TSchema>(type: Type, payload: Payload) {
  return Type.Object({ id: Type.Optional(Type.String()), type: Type.Literal(type), payload });
}

// What a client names in a command. These are the shapes the API hands out,
// so a value outside them was never one of its rooms, peers or sessions.
const RoomId = Type.String({ pattern: '^[A-Za-z0-9_-]{3,48}$' });
const PeerId = Type.String({ pattern: '^[A-Za-z0-9_-]{8,80}$' });
const SessionToken = Type.String({ pattern: '^[A-Za-z0-9_-]{32,128}$' });
const UserId = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
});

export const TypingActivity = Type.Union([Type.Literal('typing'), Type.Literal('emoji')]);
export type TypingActivity = Static<typeof TypingActivity>;

export const RoomTypist = Type.Object({ peerId: Type.String(), userId: Nullable(Type.String()), name: Type.String() });
export type RoomTypist = Static<typeof RoomTypist>;

/** A room peer as the lobby's room card shows it. */
export const RoomPeerSummary = Type.Object({
  id: Type.String(),
  accountUserId: Type.Optional(Type.String()),
  avatarAccent: Type.Optional(Nullable(Type.String())),
  avatarColorKey: Type.String(),
  avatarUrl: Type.Optional(Nullable(Type.String())),
  muted: Type.Boolean(),
  name: Type.String()
});
export type RoomPeerSummary = Static<typeof RoomPeerSummary>;

/** The lobby's live room card: who is there and what is new. */
export const RoomRealtimeSummary = Type.Object({
  roomId: Type.String(),
  avatarUrl: Type.Optional(Nullable(Type.String())),
  name: Type.String(),
  isStatic: Type.Boolean(),
  relationship: RoomRelationship,
  peers: Type.Number(),
  visiblePeers: Type.Array(RoomPeerSummary),
  hiddenPeerCount: Type.Number(),
  lastMessageAt: Type.Optional(Nullable(Type.Number())),
  unreadCount: Type.Optional(Type.Number())
});
export type RoomRealtimeSummary = Static<typeof RoomRealtimeSummary>;

// --- client → server ---------------------------------------------------------------

/** What joining or leaving voice proves: the peer and its session in the room. */
export const VoiceTarget = Type.Object({ roomId: RoomId, peerId: PeerId, sessionToken: SessionToken });
export type VoiceTarget = Static<typeof VoiceTarget>;

/** The fields of its own peer a client may change; each one present is applied. */
export const PeerPatch = Type.Object({
  name: Type.Optional(Type.String()),
  muted: Type.Optional(Type.Boolean()),
  deafened: Type.Optional(Type.Boolean()),
  camera: Type.Optional(Type.Boolean()),
  screen: Type.Optional(Type.Boolean()),
  screenAudio: Type.Optional(Type.Boolean()),
  screenProfileId: Type.Optional(Type.String()),
  screenStreamId: Type.Optional(Type.String()),
  viewedScreenPeerId: Type.Optional(Nullable(Type.String())),
  /** The client's own read of its connection; sent alone, and only when it changes. */
  network: Type.Optional(NetworkLevel)
});
export type PeerPatch = Static<typeof PeerPatch>;

/** A video source the server's media budget counts. */
export const MediaKind = Type.Union([Type.Literal('screen'), Type.Literal('camera')]);
export type MediaKind = Static<typeof MediaKind>;

/**
 * The answer to room.media.request, sent with the request's id. A grant may
 * carry a lower screen profile than the one asked for when the server is busy.
 */
export const MediaGrant = Type.Union([
  Type.Object({
    roomId: Type.String(),
    kind: MediaKind,
    granted: Type.Literal(true),
    profileId: Type.Optional(Type.String())
  }),
  Type.Object({
    roomId: Type.String(),
    kind: MediaKind,
    granted: Type.Literal(false),
    reason: Type.Literal('server_busy')
  }),
  Type.Object({
    roomId: Type.String(),
    kind: MediaKind,
    granted: Type.Literal(false),
    reason: Type.Literal('room_screens_full'),
    maxRoomScreens: Type.Number()
  })
]);
export type MediaGrant = Static<typeof MediaGrant>;

/**
 * Every command the server handles, as a frame schema. Chat and DM sends still
 * travel over HTTP, so a command appears here only once the WS server handles
 * it: a client must not believe in a channel the server silently drops.
 */
export const ClientCommandFrames = {
  hello: Frame('hello', Type.Object({})),
  ping: Frame('ping', Type.Object({ at: Type.Number() })),
  'room.preview.subscribe': Frame('room.preview.subscribe', Type.Object({ roomId: RoomId })),
  'room.preview.unsubscribe': Frame('room.preview.unsubscribe', Type.Object({ roomId: RoomId })),
  /** `guestId` is the browser's lasting guest id (see normalizeGuestId); the API keeps it only for guests. */
  'room.join': Frame(
    'room.join',
    Type.Object({ ...VoiceTarget.properties, name: Type.String(), guestId: Type.Optional(Type.String()) })
  ),
  'room.leave': Frame('room.leave', VoiceTarget),
  'room.peer.update': Frame('room.peer.update', Type.Object({ ...VoiceTarget.properties, patch: PeerPatch })),
  /** Asked before a screen share or a camera starts; answered with room.media.grant. */
  'room.media.request': Frame(
    'room.media.request',
    Type.Object({ ...VoiceTarget.properties, kind: MediaKind, profileId: Type.Optional(Type.String()) })
  ),
  /** A notice without an activity comes from a client older than the emoji picker and means typing. */
  'room.chat.typing': Frame(
    'room.chat.typing',
    Type.Object({ roomId: RoomId, activity: Type.Optional(TypingActivity) })
  ),
  'dm.typing': Frame('dm.typing', Type.Object({ userId: UserId, activity: Type.Optional(TypingActivity) }))
};
type ClientCommandFrames = typeof ClientCommandFrames;

export type ClientCommandType = keyof ClientCommandFrames;
export type ClientCommands = { [Type in ClientCommandType]: Static<ClientCommandFrames[Type]>['payload'] };
export type ClientCommand = {
  [Type in ClientCommandType]: { id?: string; type: Type; payload: ClientCommands[Type] };
}[ClientCommandType];

// --- server → client ---------------------------------------------------------------

/** Someone a notification is about, trimmed to what the notification shows. */
export const NotificationActor = Type.Object({
  id: Type.String(),
  displayName: Type.Optional(Type.String()),
  login: Type.Optional(Type.String()),
  avatarColorKey: Type.Optional(Type.String()),
  avatarAccent: Type.Optional(Nullable(Type.String())),
  avatarUrl: Type.Optional(Nullable(Type.String()))
});
export type NotificationActor = Static<typeof NotificationActor>;

export const NotificationMessageBrief = Type.Object({
  id: Type.String(),
  body: Type.String(),
  createdAt: Type.Number()
});
export type NotificationMessageBrief = Static<typeof NotificationMessageBrief>;

export const NotificationRoomContext = Type.Object({
  roomId: Type.String(),
  name: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Nullable(Type.String()))
});
export type NotificationRoomContext = Static<typeof NotificationRoomContext>;

/** A room as a preview or the room screen first sees it. */
export const RoomSnapshot = Type.Object({
  roomId: Type.String(),
  room: LobbyRoom,
  peers: Type.Array(PublicPeer),
  recentMessages: Type.Array(RoomMessage),
  /** When the current voice session started (first live peer), null while the room is empty. */
  voiceActiveSince: Nullable(Type.Number()),
  mode: Type.Union([Type.Literal('preview'), Type.Literal('active')])
});
export type RoomSnapshot = Static<typeof RoomSnapshot>;

/** Why a peer left its voice seat (room.peer.left, room.left). */
export const PeerLeaveReason = Type.Union([
  /** It left, or its socket closed for good. */
  Type.Literal('left'),
  /** Its socket dropped and it did not come back within the reconnect lease. */
  Type.Literal('lost'),
  /** A newer join of the same seat took over. */
  Type.Literal('replaced'),
  /** Its join was refused after it had taken the seat. */
  Type.Literal('join-rejected'),
  Type.Literal('kicked'),
  Type.Literal('banned'),
  /** The room was deleted. */
  Type.Literal('deleted'),
  /** The account left the room's membership. */
  Type.Literal('left-room'),
  Type.Literal('membership-left')
]);
export type PeerLeaveReason = Static<typeof PeerLeaveReason>;

/** What changed a room's pins: a pin, an unpin, or an edit or deletion of a pinned message. */
export const PinAction = Type.Union([
  Type.Literal('pinned'),
  Type.Literal('unpinned'),
  Type.Literal('message-edited'),
  Type.Literal('message-deleted'),
  Type.Literal('refreshed')
]);
export type PinAction = Static<typeof PinAction>;

/** Room ids are opaque here: the server names its own rooms. */
const RoomRef = { roomId: Type.String() };

export const ServerEventFrames = {
  ready: Frame(
    'ready',
    Type.Object({
      userId: Type.Optional(Type.String()),
      guest: Type.Optional(Type.Boolean()),
      onlineFriendIds: Type.Optional(Type.Array(Type.String()))
    })
  ),
  pong: Frame('pong', Type.Object({ at: Type.Number() })),

  // Friends and the account
  'friend.presence': Frame('friend.presence', Type.Object({ userId: Type.String(), online: Type.Boolean() })),
  'friend.request': Frame(
    'friend.request',
    Type.Object({ direction: Type.Union([Type.Literal('incoming'), Type.Literal('outgoing')]) })
  ),
  'friend.accepted': Frame('friend.accepted', Type.Object({ userId: Type.String() })),
  'friend.removed': Frame('friend.removed', Type.Object({ userId: Type.String() })),
  'friend.updated': Frame('friend.updated', Type.Object({ user: PublicUser })),
  'ring.incoming': Frame(
    'ring.incoming',
    Type.Object({
      fromUser: NotificationActor,
      room: Type.Object({ id: Type.String(), name: Type.String(), emoji: Type.String() }),
      expiresAt: Type.Number()
    })
  ),
  'notification.settings.updated': Frame(
    'notification.settings.updated',
    Type.Object({ preferences: NotificationPreferences })
  ),
  'account.login.new': Frame('account.login.new', Type.Object({ alert: LoginAlert })),
  'account.login.resolved': Frame(
    'account.login.resolved',
    Type.Object({
      alertId: Type.String(),
      resolution: Type.Union([Type.Literal('confirmed'), Type.Literal('denied')])
    })
  ),
  /** To platform administrators only: the open reports changed. */
  'admin.reports': Frame('admin.reports', AdminReportsEvent),

  // Direct messages
  'dm.message': Frame('dm.message', Type.Object({ message: DirectMessage })),
  'dm.message.edited': Frame('dm.message.edited', Type.Object({ message: DirectMessage })),
  'dm.message.deleted': Frame(
    'dm.message.deleted',
    Type.Object({ messageId: Type.String(), peerUserId: Type.Optional(Type.String()) })
  ),
  'dm.read': Frame('dm.read', Type.Object({ userId: Type.String() })),
  'dm.typing': Frame('dm.typing', Type.Object({ userId: Type.String(), activity: TypingActivity })),

  // Notifications the web may show outside the conversation they are about
  'notification.dm.message': Frame(
    'notification.dm.message',
    Type.Object({ dedupeKey: Type.String(), peer: NotificationActor, message: NotificationMessageBrief })
  ),
  'notification.room.message': Frame(
    'notification.room.message',
    Type.Object({
      dedupeKey: Type.String(),
      room: NotificationRoomContext,
      sender: NotificationActor,
      message: NotificationMessageBrief
    })
  ),
  'notification.friend.request': Frame(
    'notification.friend.request',
    Type.Object({ dedupeKey: Type.String(), requester: NotificationActor, requestId: Type.String() })
  ),
  'notification.friend.accepted': Frame(
    'notification.friend.accepted',
    Type.Object({
      dedupeKey: Type.String(),
      user: NotificationActor,
      context: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
    })
  ),

  // Rooms: the lobby summary, the preview/detail stream and voice
  'room.summary': Frame('room.summary', Type.Object({ room: RoomRealtimeSummary })),
  'room.snapshot': Frame('room.snapshot', RoomSnapshot),
  'room.updated': Frame('room.updated', Type.Object({ room: LobbyRoom })),
  'room.deleted': Frame('room.deleted', Type.Object(RoomRef)),
  'room.not_found': Frame('room.not_found', Type.Object(RoomRef)),
  'room.full': Frame('room.full', Type.Object({ ...RoomRef, maxRoomPeers: Type.Number() })),
  /** Voice refused because the whole server holds MAX_VOICE_PEERS people already. */
  'server.full': Frame('server.full', Type.Object({ ...RoomRef, maxVoicePeers: Type.Number() })),
  'room.media.grant': Frame('room.media.grant', MediaGrant),
  'room.kicked': Frame('room.kicked', Type.Object({ ...RoomRef, peerId: Type.Optional(Type.String()) })),
  'room.banned': Frame('room.banned', Type.Object({ ...RoomRef, peerId: Type.Optional(Type.String()) })),
  'room.left': Frame('room.left', Type.Object({ ...RoomRef, peerId: Type.String(), reason: PeerLeaveReason })),
  'room.peer.joined': Frame('room.peer.joined', Type.Object({ ...RoomRef, peer: PublicPeer })),
  'room.peer.left': Frame(
    'room.peer.left',
    Type.Object({ ...RoomRef, peerId: Type.String(), reason: PeerLeaveReason })
  ),
  'room.peer.updated': Frame('room.peer.updated', Type.Object({ ...RoomRef, peer: PublicPeer })),
  'room.chat.message': Frame('room.chat.message', Type.Object({ ...RoomRef, message: RoomMessage })),
  'room.chat.edited': Frame('room.chat.edited', Type.Object({ ...RoomRef, message: RoomMessage })),
  'room.chat.deleted': Frame('room.chat.deleted', Type.Object({ ...RoomRef, messageId: Type.String() })),
  'room.chat.typing': Frame(
    'room.chat.typing',
    Type.Object({ ...RoomRef, typist: RoomTypist, activity: TypingActivity })
  ),
  'room.pins': Frame(
    'room.pins',
    Type.Object({
      ...RoomRef,
      action: PinAction,
      messageId: Type.String(),
      pins: Type.Array(PinnedMessage),
      count: Type.Number()
    })
  ),
  'reaction.updated': Frame(
    'reaction.updated',
    Type.Object({
      conversation: ConversationRef,
      roomId: Type.Optional(Type.String()),
      messageId: Type.String(),
      summary: ReactionSummary
    })
  )
};
type ServerEventFrames = typeof ServerEventFrames;

export type ServerEventType = keyof ServerEventFrames;
export type ServerEvents = { [Type in ServerEventType]: Static<ServerEventFrames[Type]>['payload'] };
/** The event of one type. */
export type ServerEventOf<Type extends ServerEventType> = { id?: string; type: Type; payload: ServerEvents[Type] };
export type ServerEvent = { [Type in ServerEventType]: ServerEventOf<Type> }[ServerEventType];

/**
 * A refused command or an unusable frame; `id` echoes the command's. The API
 * sends only ERROR_CODES, but the wire takes any code: a server deployed after
 * a tab loaded may send one that tab does not know, and the refusal must still
 * reach it (the web narrows the code with isErrorCode).
 */
export const ServerErrorFrame = Type.Object({
  id: Type.Optional(Type.String()),
  type: Type.Literal('error'),
  error: Type.Object({ code: Type.String(), message: Type.String() })
});
export type ServerErrorFrame = Static<typeof ServerErrorFrame>;

/** Any frame the server sends. */
export type ServerFrame = ServerEvent | ServerErrorFrame;
