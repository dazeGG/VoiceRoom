// Pinned room messages. Any room participant may pin; the server caps a room at
// 50 pins and returns the whole list on every mutation so callers never have to
// reconcile a partial update.

import { PinList, type PinnedMessage } from '@voice-room/shared/contracts/messages';
import { api } from './client';

export type { PinnedMessage };
export type PinnedMessageAuthor = PinnedMessage['author'];

export interface PinSnapshot {
  pins: PinnedMessage[];
  count: number;
}

function pinUrl(roomId: string, messageId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/pins/${encodeURIComponent(messageId)}`;
}

const snapshot = ({ pins, count }: PinList): PinSnapshot => ({ pins, count });

export async function fetchRoomPins(roomId: string): Promise<PinSnapshot> {
  return snapshot(await api.get(`/api/rooms/${encodeURIComponent(roomId)}/pins`, PinList));
}

export async function pinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  return snapshot(await api.put(pinUrl(roomId, messageId), PinList));
}

export async function unpinRoomMessage(roomId: string, messageId: string): Promise<PinSnapshot> {
  return snapshot(await api.delete(pinUrl(roomId, messageId), PinList));
}
