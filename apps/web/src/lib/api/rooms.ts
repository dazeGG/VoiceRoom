import { del, fetchJson, postJson, postJsonAuth, putJson } from './http';
import { createRoomProof } from './pow';

export interface CreateRoomOptions {
  isStatic?: boolean;
  name?: string;
}

export interface UpdateRoomOptions {
  name: string;
}

// Mirrors the server's publicLobbyRoom() shape (server.js) — the same body the
// PUT response and the room.updated WebSocket broadcast both carry.
export interface RoomSummary {
  avatarUrl: string | null;
  createdAt: number;
  emptySince: number | null;
  isStatic: boolean;
  name: string;
  peers: number;
  relationship: string;
  roomId: string;
}

export interface RoomStatus {
  avatarUrl: string | null;
  createdAt: number;
  name: string;
  emptySince: number | null;
  exists: boolean;
  isStatic: boolean;
  maxRoomPeers: number;
  peers: number;
  roomId: string;
}

async function roomAvatarRequest(roomId: string, method: 'POST' | 'DELETE', file?: Blob): Promise<RoomSummary> {
  const body = file ? new FormData() : undefined;
  if (body && file) body.append('avatar', file, 'avatar.webp');
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/avatar`, { method, body, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Не удалось обновить аватар комнаты');
  return payload.room;
}

export const uploadRoomAvatar = (roomId: string, file: Blob): Promise<RoomSummary> => roomAvatarRequest(roomId, 'POST', file);
export const deleteRoomAvatar = (roomId: string): Promise<RoomSummary> => roomAvatarRequest(roomId, 'DELETE');

export interface ChatMessage {
  avatarAccent: string | null;
  avatarColorKey: string;
  avatarUrl: string | null;
  createdAt: number;
  expiresAt: number;
  id: string;
  name: string;
  peerId: string;
  roomId: string;
  text: string;
}

interface CreateRoomResponse {
  createdAt: number;
  isStatic: boolean;
  name: string;
  roomId: string;
}

export async function createRoom(options: CreateRoomOptions = {}): Promise<string> {
  const proof = await createRoomProof();
  const room = await postJson<CreateRoomResponse>('/api/rooms', {
    isStatic: Boolean(options.isStatic),
    name: options.name ?? '',
    proof
  });
  return room.roomId;
}

export async function updateRoom(roomId: string, options: UpdateRoomOptions): Promise<RoomSummary> {
  const payload = await putJson<{ room: RoomSummary }>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    name: options.name
  });
  return payload.room;
}

export async function deleteRoom(roomId: string): Promise<void> {
  await del(`/api/rooms/${encodeURIComponent(roomId)}`);
}

export async function ringRoomFriend(roomId: string, userId: string): Promise<void> {
  await postJsonAuth(`/api/rooms/${encodeURIComponent(roomId)}/ring`, { userId });
}

// A read-only view of a current room occupant (mirrors the server's publicPeer).
export interface RoomPeer {
  accountUserId?: string;
  avatarAccent: string | null;
  avatarColorKey: string;
  avatarUrl: string | null;
  id: string;
  muted: boolean;
  name: string;
}

export async function kickRoomPeer(roomId: string, peerId: string): Promise<void> {
  await postJsonAuth(`/api/rooms/${encodeURIComponent(roomId)}/kick`, { peerId });
}

export async function banRoomPeer(roomId: string, peerId: string): Promise<string> {
  const payload = await postJsonAuth<{ banId: string }>(`/api/rooms/${encodeURIComponent(roomId)}/ban`, { peerId });
  return payload.banId;
}

export async function undoRoomBan(roomId: string, banId: string): Promise<void> {
  await del(`/api/rooms/${encodeURIComponent(roomId)}/bans/${encodeURIComponent(banId)}`);
}

// Snapshot of who is in a room right now, without joining it — powers the lobby
// room preview.
export async function fetchRoomPeers(roomId: string): Promise<RoomPeer[]> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/peers`, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error('Не удалось загрузить участников');
  const payload = (await response.json()) as { peers?: RoomPeer[] };
  return Array.isArray(payload.peers) ? payload.peers : [];
}

export async function fetchRoomStatus(roomId: string): Promise<RoomStatus | null> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Не удалось проверить комнату');

  const payload = await response.json();
  return payload as RoomStatus;
}

export async function fetchRoomChat(roomId: string): Promise<ChatMessage[]> {
  const payload = (await fetchJson(`/api/rooms/${encodeURIComponent(roomId)}/chat`)) as {
    messages?: ChatMessage[];
  };
  return Array.isArray(payload?.messages) ? (payload.messages as ChatMessage[]) : [];
}

export async function postRoomChat(
  roomId: string,
  body: { name: string; peerId?: string; sessionToken?: string; text: string }
): Promise<ChatMessage> {
  const payload = await postJson<{ message: ChatMessage }>(`/api/rooms/${encodeURIComponent(roomId)}/chat`, body);
  return payload.message;
}

export async function deleteRoomChatMessage(
  roomId: string,
  messageId: string,
  body?: { peerId?: string; sessionToken?: string }
): Promise<{ ok: boolean; deleted?: boolean }> {
  const payload = await del<{ ok: boolean; deleted?: boolean }>(
    `/api/rooms/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}`,
    body ?? {}
  );
  return payload;
}
