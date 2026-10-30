// Pinned messages for the open room. The server returns the full list on every
// mutation and broadcasts the same shape over the room detail stream, so this
// store only ever replaces its snapshot — there is no incremental merge to get
// wrong.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchRoomPins, pinRoomMessage, unpinRoomMessage, type PinnedMessage } from '@/api/pins';

export const useRoomPinsStore = defineStore('room-pins', () => {
  const roomId = ref('');
  const pins = ref<PinnedMessage[]>([]);
  const loaded = ref(false);
  /** Whether the strip above the chat lists the pins or only counts them. */
  const expanded = ref(false);

  // Every list the room gets goes through here. When the last pin goes the strip
  // folds back, so the next pin shows as a count again instead of reopening a
  // panel nobody asked for.
  function setPins(next: PinnedMessage[]): void {
    pins.value = next;
    if (!next.length) expanded.value = false;
  }

  let inFlightRoomId = '';

  function isMessagePinned(messageId: string): boolean {
    return pins.value.some((pin) => pin.messageId === messageId);
  }

  function resetRoomPins(): void {
    inFlightRoomId = '';
    roomId.value = '';
    setPins([]);
    loaded.value = false;
  }

  /** Applies a `room.pins` realtime payload. Ignores events for another room. */
  function applyRoomPinsEvent(eventRoomId: string, payload: { pins: PinnedMessage[] }): void {
    if (!eventRoomId || eventRoomId !== roomId.value) return;
    setPins(payload.pins);
    loaded.value = true;
  }

  async function loadRoomPins(targetRoomId: string): Promise<void> {
    if (!targetRoomId || inFlightRoomId === targetRoomId) return;
    inFlightRoomId = targetRoomId;
    if (roomId.value !== targetRoomId) {
      roomId.value = targetRoomId;
      setPins([]);
      loaded.value = false;
    }
    try {
      const snapshot = await fetchRoomPins(targetRoomId);
      // A room switch mid-request must not overwrite the new room's list.
      if (roomId.value !== targetRoomId) return;
      setPins(snapshot.pins);
      loaded.value = true;
    } catch {
      if (roomId.value === targetRoomId) loaded.value = true;
    } finally {
      if (inFlightRoomId === targetRoomId) inFlightRoomId = '';
    }
  }

  async function togglePin(targetRoomId: string, messageId: string): Promise<void> {
    const snapshot = isMessagePinned(messageId)
      ? await unpinRoomMessage(targetRoomId, messageId)
      : await pinRoomMessage(targetRoomId, messageId);
    if (roomId.value !== targetRoomId) return;
    setPins(snapshot.pins);
    loaded.value = true;
  }

  return {
    roomId,
    pins,
    loaded,
    expanded,
    isMessagePinned,
    resetRoomPins,
    applyRoomPinsEvent,
    loadRoomPins,
    togglePin
  };
});
