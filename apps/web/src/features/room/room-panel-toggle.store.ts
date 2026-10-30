// The chat and participants buttons of a room's top bar, desktop and phone alike.

import { defineStore } from 'pinia';
import { markRoomChatRead } from '@/api/rooms';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { state as roomClientState } from './client/core/room-runtime.store';
import { useRoomUiStore, type RoomPanelTab } from './room-ui.store';

export const useRoomPanelToggleStore = defineStore('room-panel-toggle', () => {
  function getRoomUnreadCount(): number {
    const roomUi = useRoomUiStore();
    const roomPresence = useRoomPresenceStore();
    return Math.max(roomUi.unreadChat, roomPresence.unreadCountByRoomId[roomClientState.roomId] ?? 0);
  }

  function isRoomPanelOpen(tab: RoomPanelTab): boolean {
    const roomUi = useRoomUiStore();
    return roomUi.chatOpen && roomUi.activePanel === tab;
  }

  /** Opens that panel, or closes it when it is the one already open. */
  function toggleRoomPanel(tab: RoomPanelTab): void {
    const roomUi = useRoomUiStore();
    if (isRoomPanelOpen(tab)) {
      roomUi.closeChat();
      return;
    }
    roomUi.selectRoomPanel(tab);
    if (tab !== 'chat') return;
    useRoomPresenceStore().setRoomUnreadCount(roomClientState.roomId, 0);
    // Read state is kept for rooms in the account's list; a temporary room is never there.
    if (roomClientState.self?.accountUserId && roomClientState.roomIsStatic)
      void markRoomChatRead(roomClientState.roomId).catch(() => {});
  }

  return { getRoomUnreadCount, isRoomPanelOpen, toggleRoomPanel };
});
