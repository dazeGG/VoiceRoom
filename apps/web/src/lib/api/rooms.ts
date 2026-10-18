import { Done } from '@voice-room/shared/contracts/http';
import {
  MessageDeleted,
  RoomChat,
  RoomHistoryPage,
  RoomMessageAnswer,
  RoomRead,
  type Attachment,
  type HistoryMode,
  type MessageContent,
  type ReactionSummary,
  type ReplyPointer,
  type RoomHistoryMessage,
  type RoomMessage
} from '@voice-room/shared/contracts/messages';
import {
  PeerBanned,
  RoomCard,
  RoomCreated,
  RoomStatus as RoomStatusAnswer,
  ServerMuted,
  type LobbyRoom,
  type PublicPeer
} from '@voice-room/shared/contracts/rooms';
import { api, orNull } from './client';
import { createRoomProof } from './pow';
import type { ReplyTarget } from '$lib/shared/chat/reply-store.svelte';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import { projectRoomMessageContent } from '@voice-room/shared/room-message-content';

export interface CreateRoomOptions {
  isStatic?: boolean;
  name?: string;
}

export interface UpdateRoomOptions {
  name: string;
}

/** The lobby card: the rename answer, the room list and the room.updated event. */
export type RoomSummary = LobbyRoom;

/** The public status card of a room that exists. */
export type RoomStatus = Omit<RoomStatusAnswer, 'ok'>;

/** A read-only view of a current room occupant. */
export type RoomPeer = PublicPeer;

async function roomAvatarRequest(roomId: string, method: 'POST' | 'DELETE', file?: Blob): Promise<RoomSummary> {
  let body: FormData | undefined;
  if (file) {
    body = new FormData();
    body.append('avatar', file, 'avatar.webp');
  }
  const url = `/api/rooms/${encodeURIComponent(roomId)}/avatar`;
  const fallback = 'Не удалось обновить аватар комнаты';
  const answer =
    method === 'POST'
      ? await api.post(url, RoomCard, body, { fallback })
      : await api.delete(url, RoomCard, undefined, { fallback });
  return answer.room;
}

export const uploadRoomAvatar = (roomId: string, file: Blob): Promise<RoomSummary> =>
  roomAvatarRequest(roomId, 'POST', file);
export const deleteRoomAvatar = (roomId: string): Promise<RoomSummary> => roomAvatarRequest(roomId, 'DELETE');

/**
 * A room message as the chat UI holds it: the contract's RoomMessage with the
 * expiry always set and the history cursors when the message came from a page.
 */
export type ChatMessage = Omit<RoomMessage, 'expiresAt' | 'content' | 'attachments' | 'replyTo' | 'replyPreview'> & {
  expiresAt: number;
  content?: MessageContent;
  cursor?: string;
  readCursor?: string;
  attachments?: Attachment[];
  replyTo?: ReplyPointer;
  replyPreview?: ReplyTarget;
  /** The reactions a history page carried; realtime keeps the reaction store current after that. */
  reactions?: ReactionSummary[];
};

/** A message that never expires shows no countdown. */
const NEVER = Number.MAX_SAFE_INTEGER;

export function chatMessageFromRoomMessage(message: RoomMessage): ChatMessage {
  return {
    ...message,
    expiresAt: message.expiresAt ?? NEVER,
    content: message.content ?? undefined,
    replyTo: message.replyTo ?? undefined,
    replyPreview: message.replyPreview ?? undefined
  };
}

export type RoomChatHistoryPage = Omit<RoomHistoryPage, 'messages'> & { messages: ChatMessage[] };

export interface HistoryPageRequest {
  mode?: HistoryMode;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  messageId?: string;
}

export async function createRoom(options: CreateRoomOptions = {}): Promise<string> {
  const proof = await createRoomProof();
  const room = await api.post('/api/rooms', RoomCreated, {
    isStatic: Boolean(options.isStatic),
    name: options.name ?? '',
    proof
  });
  return room.roomId;
}

export async function updateRoom(roomId: string, options: UpdateRoomOptions): Promise<RoomSummary> {
  const payload = await api.put(`/api/rooms/${encodeURIComponent(roomId)}`, RoomCard, {
    name: options.name
  });
  return payload.room;
}

export async function deleteRoom(roomId: string): Promise<void> {
  await api.delete(`/api/rooms/${encodeURIComponent(roomId)}`, Done);
}

export async function ringRoomFriend(roomId: string, userId: string): Promise<void> {
  await api.post(`/api/rooms/${encodeURIComponent(roomId)}/ring`, Done, { userId });
}

export async function kickRoomPeer(roomId: string, peerId: string): Promise<void> {
  await api.post(`/api/rooms/${encodeURIComponent(roomId)}/kick`, Done, { peerId });
}

export async function setRoomPeerServerMute(roomId: string, peerId: string, muted: boolean): Promise<void> {
  await api.post(`/api/rooms/${encodeURIComponent(roomId)}/server-mute`, ServerMuted, { peerId, muted });
}

export async function banRoomPeer(roomId: string, peerId: string): Promise<string> {
  const payload = await api.post(`/api/rooms/${encodeURIComponent(roomId)}/ban`, PeerBanned, { peerId });
  return payload.banId;
}

export async function undoRoomBan(roomId: string, banId: string): Promise<void> {
  await api.delete(`/api/rooms/${encodeURIComponent(roomId)}/bans/${encodeURIComponent(banId)}`, Done);
}

export async function fetchRoomStatus(roomId: string): Promise<RoomStatus | null> {
  const answer = await orNull(
    api.get(`/api/rooms/${encodeURIComponent(roomId)}`, RoomStatusAnswer, { fallback: 'Не удалось проверить комнату' })
  );
  if (!answer) return null;
  const { ok: _ok, ...status } = answer;
  return status;
}

export async function fetchRoomChat(roomId: string): Promise<ChatMessage[]> {
  return (await api.get(`/api/rooms/${encodeURIComponent(roomId)}/chat`, RoomChat)).messages.map(
    chatMessageFromRoomMessage
  );
}

export async function fetchRoomChatPage(
  roomId: string,
  request: HistoryPageRequest = {}
): Promise<RoomChatHistoryPage> {
  const params = new URLSearchParams({
    mode: request.mode ?? 'latest',
    limit: String(request.limit ?? 50)
  });
  if (request.cursor) params.set('cursor', request.cursor);
  if (request.messageId) params.set('messageId', request.messageId);
  const page = await api.get(`/api/rooms/${encodeURIComponent(roomId)}/chat/history?${params}`, RoomHistoryPage, {
    signal: request.signal,
    fallback: 'Не удалось загрузить историю комнаты'
  });
  return { ...page, messages: page.messages.map((message) => roomMessageFromHistory(roomId, message)) };
}

function roomMessageFromHistory(roomId: string, message: RoomHistoryMessage): ChatMessage {
  const { author, content } = message;
  const structured = 'version' in content ? content : undefined;
  return {
    id: message.id,
    roomId,
    authorUserId: author.userId,
    peerId: author.peerId,
    name: author.name || 'Гость',
    avatarColorKey: author.avatarColorKey ?? '',
    avatarUrl: author.avatarUrl,
    avatarAccent: author.avatarAccent,
    text: projectRoomMessageContent(content, 'text' in content ? content.text : ''),
    content: structured,
    createdAt: message.createdAt ?? Date.now(),
    editedAt: message.editedAt ?? null,
    expiresAt: message.expiresAt ?? NEVER,
    cursor: message.cursor,
    readCursor: message.readCursor,
    attachments: message.attachments,
    linkPreview: message.linkPreview,
    replyTo: message.replyTo ?? undefined,
    replyPreview: message.replyPreview ?? undefined,
    reactions: message.reactions
  };
}

export async function markRoomChatRead(roomId: string, cursor?: string): Promise<string | undefined> {
  return (await api.post(`/api/rooms/${encodeURIComponent(roomId)}/read`, RoomRead, cursor ? { cursor } : {})).cursor;
}

export async function postRoomChat(
  roomId: string,
  body: {
    name: string;
    peerId?: string;
    sessionToken?: string;
    text: string;
    content?: RoomMessageContentV1;
    attachmentIds?: string[];
    replyTo?: { messageId: string };
    idempotencyKey?: string;
  }
): Promise<ChatMessage> {
  const payload = await api.post(`/api/rooms/${encodeURIComponent(roomId)}/chat`, RoomMessageAnswer, body);
  return chatMessageFromRoomMessage(payload.message);
}

export async function deleteRoomChatMessage(
  roomId: string,
  messageId: string,
  body?: { peerId?: string; sessionToken?: string }
): Promise<MessageDeleted> {
  return api.delete(
    `/api/rooms/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}`,
    MessageDeleted,
    body ?? {}
  );
}

export async function editRoomChatMessage(
  roomId: string,
  messageId: string,
  body: { text: string; peerId?: string; sessionToken?: string }
): Promise<ChatMessage> {
  const payload = await api.patch(
    `/api/rooms/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}`,
    RoomMessageAnswer,
    body
  );
  return chatMessageFromRoomMessage(payload.message);
}
