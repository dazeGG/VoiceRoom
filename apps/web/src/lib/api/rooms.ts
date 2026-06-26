import { del, fetchJson, postJson, putJson } from './http';
import { createRoomProof } from './pow';

export interface CreateRoomOptions {
  isStatic?: boolean;
  name?: string;
  emoji?: string;
  roomPresetKey?: string;
}

export interface UpdateRoomOptions {
  name: string;
  roomPresetKey: string;
  emoji?: string;
}

// Mirrors the server's publicLobbyRoom() shape (server.js) — the same body the
// PUT response and the room-updated SSE broadcast both carry.
export interface RoomSummary {
  createdAt: number;
  emoji: string;
  roomColorKey: string;
  roomIconKey: string;
  roomPresetKey: string;
  emptySince: number | null;
  isStatic: boolean;
  name: string;
  peers: number;
  relationship: string;
  roomId: string;
}

export interface RoomStatus {
  createdAt: number;
  emoji: string;
  name: string;
  roomColorKey: string;
  roomIconKey: string;
  roomPresetKey: string;
  emptySince: number | null;
  exists: boolean;
  isStatic: boolean;
  maxRoomPeers: number;
  peers: number;
  roomId: string;
}

export interface ChatMessage {
  avatarColorKey: string;
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
  emoji: string;
  roomColorKey: string;
  roomIconKey: string;
  roomPresetKey: string;
  isStatic: boolean;
  name: string;
  roomId: string;
}

export async function createRoom(options: CreateRoomOptions = {}): Promise<string> {
  const proof = await createRoomProof();
  const room = await postJson<CreateRoomResponse>('/api/rooms', {
    isStatic: Boolean(options.isStatic),
    name: options.name ?? '',
    emoji: options.emoji ?? '',
    roomPresetKey: options.roomPresetKey ?? '',
    proof
  });
  return room.roomId;
}

export async function updateRoom(roomId: string, options: UpdateRoomOptions): Promise<RoomSummary> {
  const payload = await putJson<{ room: RoomSummary }>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    name: options.name,
    roomPresetKey: options.roomPresetKey,
    emoji: options.emoji ?? ''
  });
  return payload.room;
}

export async function deleteRoom(roomId: string): Promise<void> {
  await del(`/api/rooms/${encodeURIComponent(roomId)}`);
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
