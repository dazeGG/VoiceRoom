// Pinned room messages. Any room participant may pin; the server caps a room at
// 50 pins and returns the whole list on every mutation so callers never have to
// reconcile a partial update.

import type { PinList, PinnedMessage as PinnedMessageView } from '@voice-room/shared/contracts/messages';
import { normalizeRoomMessageContent } from '@voice-room/shared/room-message-content';
import { api } from './client';
export type PinnedMessage = PinnedMessageView;
export type PinnedMessageAuthor = PinnedMessage['author'];

export interface PinSnapshot {
  pins: PinnedMessage[];
  count: number;
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
    content: normalizeRoomMessageContent(raw.content),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null
  };
}

/** Reads a pin list from a realtime event, whose payload is not typed yet. */
export function pinSnapshot(payload: { pins?: unknown; count?: unknown }): PinSnapshot {
  const pins = Array.isArray(payload.pins)
    ? payload.pins.map(pinnedMessage).filter((entry): entry is PinnedMessage => entry !== null)
    : [];
  return { pins, count: typeof payload.count === 'number' ? payload.count : pins.length };
}

function pinUrl(roomId: string, messageId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/pins/${encodeURIComponent(messageId)}`;
}

const snapshot = ({ pins, count }: PinList): PinSnapshot => ({ pins, count });

export async function fetchRoomPins(roomId: string): Promise<PinSnapshot> {
  return snapshot(await api.get<PinList>(`/api/rooms/${encodeURIComponent(roomId)}/pins`));
}

export async function pinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  return snapshot(await api.put<PinList>(pinUrl(roomId, messageId)));
}

export async function unpinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  return snapshot(await api.delete<PinList>(pinUrl(roomId, messageId)));
}
