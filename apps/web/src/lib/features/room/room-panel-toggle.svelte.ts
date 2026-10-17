// The chat and participants buttons of a room's top bar, desktop and phone alike.

import { markRoomChatRead } from '$lib/api/rooms';
import { roomPresence, setRoomUnreadCount } from '$lib/entities/room/room-presence.svelte';
import { state as roomClientState } from './client/core/state.svelte';
import { closeChat, roomUi, selectRoomPanel, type RoomPanelTab } from './room-ui.svelte';

export function getRoomUnreadCount(): number {
  return Math.max(roomUi.unreadChat, roomPresence.unreadCountByRoomId[roomClientState.roomId] ?? 0);
}

export function isRoomPanelOpen(tab: RoomPanelTab): boolean {
  return roomUi.chatOpen && roomUi.activePanel === tab;
}

/** Opens that panel, or closes it when it is the one already open. */
export function toggleRoomPanel(tab: RoomPanelTab): void {
  if (isRoomPanelOpen(tab)) {
    closeChat();
    return;
  }
  selectRoomPanel(tab);
  if (tab !== 'chat') return;
  setRoomUnreadCount(roomClientState.roomId, 0);
  // Read state is kept for rooms in the account's list; a temporary room is never there.
  if (roomClientState.self?.accountUserId && roomClientState.roomIsStatic)
    void markRoomChatRead(roomClientState.roomId).catch(() => {});
}
