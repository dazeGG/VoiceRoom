// Pinned messages for the open room. The server returns the full list on every
// mutation and broadcasts the same shape over the room detail stream, so this
// store only ever replaces its snapshot — there is no incremental merge to get
// wrong.

import {
  fetchRoomPins,
  pinRoomMessage,
  pinSnapshot,
  unpinRoomMessage,
  type PinnedMessage
} from '$lib/api/pins';

export const roomPins = $state({
  roomId: '',
  pins: [] as PinnedMessage[],
  loaded: false
});

let inFlightRoomId = '';

export function isMessagePinned(messageId: string): boolean {
  return roomPins.pins.some((pin) => pin.messageId === messageId);
}

export function resetRoomPins(): void {
  inFlightRoomId = '';
  roomPins.roomId = '';
  roomPins.pins = [];
  roomPins.loaded = false;
}

/** Applies a `room.pins` realtime payload. Ignores events for another room. */
export function applyRoomPinsEvent(roomId: string, payload: { pins?: unknown; count?: unknown }): void {
  if (!roomId || roomId !== roomPins.roomId) return;
  roomPins.pins = pinSnapshot(payload).pins;
  roomPins.loaded = true;
}

export async function loadRoomPins(roomId: string): Promise<void> {
  if (!roomId || inFlightRoomId === roomId) return;
  inFlightRoomId = roomId;
  if (roomPins.roomId !== roomId) {
    roomPins.roomId = roomId;
    roomPins.pins = [];
    roomPins.loaded = false;
  }
  try {
    const snapshot = await fetchRoomPins(roomId);
    // A room switch mid-request must not overwrite the new room's list.
    if (roomPins.roomId !== roomId) return;
    roomPins.pins = snapshot.pins;
    roomPins.loaded = true;
  } catch {
    if (roomPins.roomId === roomId) roomPins.loaded = true;
  } finally {
    if (inFlightRoomId === roomId) inFlightRoomId = '';
  }
}

export async function togglePin(roomId: string, messageId: string): Promise<void> {
  const snapshot = isMessagePinned(messageId)
    ? await unpinRoomMessage(roomId, messageId)
    : await pinRoomMessage(roomId, messageId);
  if (roomPins.roomId !== roomId) return;
  roomPins.pins = snapshot.pins;
  roomPins.loaded = true;
}
