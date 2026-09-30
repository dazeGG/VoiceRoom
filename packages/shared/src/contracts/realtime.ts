// The realtime (WebSocket /api/ws) protocol: every command a client may send
// and every event the server pushes, each with its payload. The API builds
// events only through buildServerEnvelope (typed by ServerEvents) and handles
// each ClientCommand; the web switches over ServerEvent. A frame is
// `{ id?, type, payload }`, and a refusal is the `error` frame.

import type { LoginAlert } from './account.ts';
import type { DirectMessage, PinnedMessage, RoomMessage } from './messages.ts';
import type { NotificationPreferences } from './notifications.ts';
import type { LobbyRoom, PublicPeer } from './rooms.ts';
import type { PublicUser } from './users.ts';
import type { ReactionSummary } from '../reactions.ts';

export type TypingActivity = 'typing' | 'emoji';
export type RoomTypist = { peerId: string; userId: string | null; name: string };

/** A room peer as the lobby's room card shows it. */
export type RoomPeerSummary = {
  id: string;
  accountUserId?: string;
  avatarAccent?: string | null;
  avatarColorKey: string;
  avatarUrl?: string | null;
  muted: boolean;
  name: string;
};

/** The lobby's live room card: who is there and what is new. */
export type RoomRealtimeSummary = {
  roomId: string;
  avatarUrl?: string | null;
  name: string;
  isStatic: boolean;
  relationship: string;
  peers: number;
  visiblePeers: RoomPeerSummary[];
  hiddenPeerCount: number;
  lastMessageAt?: number | null;
  unreadCount?: number;
};

// --- client → server ---------------------------------------------------------------

/** What joining or leaving voice proves: the peer and its session in the room. */
export type VoiceTarget = { roomId: string; peerId: string; sessionToken: string };

/** The fields of its own peer a client may change; each one present is applied. */
export type PeerPatch = {
  name?: string;
  muted?: boolean;
  deafened?: boolean;
  screen?: boolean;
  screenAudio?: boolean;
  screenProfileId?: string;
  screenStreamId?: string;
  viewedScreenPeerId?: string | null;
};

export type ClientCommands = {
  hello: Record<string, never>;
  ping: { at: number };
  'room.preview.subscribe': { roomId: string };
  'room.preview.unsubscribe': { roomId: string };
  'room.join': VoiceTarget & { name: string };
  'room.leave': VoiceTarget;
  'room.peer.update': VoiceTarget & { patch: PeerPatch };
  'room.chat.typing': { roomId: string; activity?: TypingActivity };
  'dm.typing': { userId: string; activity?: TypingActivity };
};
export type ClientCommandType = keyof ClientCommands;
export type ClientCommand = {
  [Type in ClientCommandType]: { id?: string; type: Type; payload: ClientCommands[Type] };
}[ClientCommandType];

// --- server → client ---------------------------------------------------------------

/** Someone a notification is about, trimmed to what the notification shows. */
export type NotificationActor = {
  id: string;
  displayName?: string;
  login?: string;
  avatarColorKey?: string;
  avatarAccent?: string | null;
  avatarUrl?: string | null;
};
export type NotificationMessageBrief = { id: string; body: string; createdAt: number };
export type NotificationRoomContext = { roomId: string; name?: string; avatarUrl?: string | null };

/** A room as a preview or the room screen first sees it. */
export type RoomSnapshot = {
  roomId: string;
  room: LobbyRoom;
  peers: PublicPeer[];
  recentMessages: RoomMessage[];
  /** When the current voice session started (first live peer), null while the room is empty. */
  voiceActiveSince: number | null;
  mode: 'preview' | 'active';
};

export type ServerEvents = {
  ready: { userId?: string; guest?: boolean; onlineFriendIds?: string[] };
  pong: { at: number };

  // Friends and the account
  'friend.presence': { userId: string; online: boolean };
  'friend.request': { direction: 'incoming' | 'outgoing' };
  'friend.accepted': { userId: string };
  'friend.removed': { userId: string };
  'friend.updated': { user: PublicUser };
  'ring.incoming': {
    fromUser: NotificationActor;
    room: { id: string; name: string; emoji: string };
    expiresAt: number;
  };
  'notification.settings.updated': { preferences: NotificationPreferences };
  'account.login.new': { alert: LoginAlert };
  'account.login.resolved': { alertId: string; resolution: 'confirmed' | 'denied' };

  // Direct messages
  'dm.message': { message: DirectMessage };
  'dm.message.edited': { message: DirectMessage };
  'dm.message.deleted': { messageId: string; peerUserId?: string };
  'dm.read': { userId: string };
  'dm.typing': { userId: string; activity: TypingActivity };

  // Notifications the web may show outside the conversation they are about
  'notification.dm.message': { dedupeKey: string; peer: NotificationActor; message: NotificationMessageBrief };
  'notification.room.message': {
    dedupeKey: string;
    room: NotificationRoomContext;
    sender: NotificationActor;
    message: NotificationMessageBrief;
  };
  'notification.friend.request': { dedupeKey: string; requester: NotificationActor; requestId: string };
  'notification.friend.accepted': {
    dedupeKey: string;
    user: NotificationActor;
    context?: Record<string, unknown>;
  };

  // Rooms: the lobby summary, the preview/detail stream and voice
  'room.summary': { room: RoomRealtimeSummary };
  'room.snapshot': RoomSnapshot;
  'room.updated': { room: LobbyRoom };
  'room.deleted': { roomId: string };
  'room.not_found': { roomId: string };
  'room.full': { roomId: string; maxRoomPeers: number };
  'room.kicked': { roomId: string; peerId?: string };
  'room.banned': { roomId: string; peerId?: string };
  'room.left': { roomId: string; peerId: string; reason: string };
  'room.peer.joined': { roomId: string; peer: PublicPeer };
  'room.peer.left': { roomId: string; peerId: string; reason: string };
  'room.peer.updated': { roomId: string; peer: PublicPeer };
  'room.chat.message': { roomId: string; message: RoomMessage };
  'room.chat.edited': { roomId: string; message: RoomMessage };
  'room.chat.deleted': { roomId: string; messageId: string };
  'room.chat.typing': { roomId: string; typist: RoomTypist; activity: TypingActivity };
  'room.pins': {
    roomId: string;
    action: string;
    messageId: string;
    pins: PinnedMessage[];
    count: number;
  };
  'reaction.updated': {
    conversation: { type: 'room' | 'dm'; id: string };
    roomId?: string;
    messageId: string;
    summary: ReactionSummary;
  };
};
export type ServerEventType = keyof ServerEvents;

/** A refused command or an unusable frame; `id` echoes the command's. */
export type ServerErrorFrame = { id?: string; type: 'error'; error: { code: string; message: string } };

export type ServerEvent = {
  [Type in ServerEventType]: { id?: string; type: Type; payload: ServerEvents[Type] };
}[ServerEventType];

/** Any frame the server sends. */
export type ServerFrame = ServerEvent | ServerErrorFrame;
