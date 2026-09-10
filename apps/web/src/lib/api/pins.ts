// Pinned room messages. Any room participant may pin; the server caps a room at
// 50 pins and returns the whole list on every mutation so callers never have to
// reconcile a partial update.

import { del, getJsonAuth, putJson } from './http';

export interface PinnedMessageAuthor {
  peerId: string;
  userId: string | null;
  name: string;
}

export interface PinnedMessage {
  messageId: string;
  pinnedBy: string;
  pinnedByName: string;
  pinnedAt: number | null;
  author: PinnedMessageAuthor;
  text: string;
  content: unknown;
  createdAt: number | null;
}

export interface PinSnapshot {
  pins: PinnedMessage[];
  count: number;
}

interface PinResponse {
  ok: true;
  pins?: unknown;
  count?: unknown;
}

function pinAuthor(value: unknown): PinnedMessageAuthor {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    peerId: typeof raw.peerId === 'string' ? raw.peerId : '',
    userId: typeof raw.userId === 'string' ? raw.userId : null,
    name: typeof raw.name === 'string' ? raw.name : ''
  };
}

function pinnedMessage(value: unknown): PinnedMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.messageId !== 'string' || !raw.messageId) return null;
  return {
    messageId: raw.messageId,
    pinnedBy: typeof raw.pinnedBy === 'string' ? raw.pinnedBy : '',
    pinnedByName: typeof raw.pinnedByName === 'string' ? raw.pinnedByName : '',
    pinnedAt: typeof raw.pinnedAt === 'number' ? raw.pinnedAt : null,
    author: pinAuthor(raw.author),
    text: typeof raw.text === 'string' ? raw.text : '',
    content: raw.content ?? null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null
  };
}

export function pinSnapshot(payload: { pins?: unknown; count?: unknown }): PinSnapshot {
  const pins = Array.isArray(payload.pins)
    ? payload.pins.map(pinnedMessage).filter((entry): entry is PinnedMessage => entry !== null)
    : [];
  return { pins, count: typeof payload.count === 'number' ? payload.count : pins.length };
}

function pinUrl(roomId: string, messageId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/pins/${encodeURIComponent(messageId)}`;
}

export async function fetchRoomPins(roomId: string): Promise<PinSnapshot> {
  const payload = await getJsonAuth<PinResponse>(`/api/rooms/${encodeURIComponent(roomId)}/pins`);
  return pinSnapshot(payload);
}

export async function pinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  const payload = await putJson<PinResponse>(pinUrl(roomId, messageId), {});
  return pinSnapshot(payload);
}

export async function unpinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  const payload = await del<PinResponse>(pinUrl(roomId, messageId));
  return pinSnapshot(payload);
}
