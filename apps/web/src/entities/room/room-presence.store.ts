import { defineStore } from 'pinia';
import { reactive, toRaw, toRefs } from 'vue';
import type { RoomPeerSummary } from '@voice-room/shared/contracts/realtime';
import type { RoomRealtimeSummary } from '@/api/realtime';

export const useRoomPresenceStore = defineStore('room-presence', () => {
  const presence = reactive<{
    peersByRoomId: Record<string, RoomPeerSummary[]>;
    hiddenPeerCountByRoomId: Record<string, number>;
    unreadCountByRoomId: Record<string, number>;
  }>({
    peersByRoomId: {},
    hiddenPeerCountByRoomId: {},
    unreadCountByRoomId: {}
  });

  // Open chat views per room; a room being read keeps its unread count at zero.
  const roomChatReadSessions: Record<string, number> = {};

  function roomChatIsBeingRead(roomId: string): boolean {
    return (roomChatReadSessions[roomId] ?? 0) > 0;
  }

  function applyRoomSummary(summary: RoomRealtimeSummary): void {
    presence.peersByRoomId = {
      ...presence.peersByRoomId,
      [summary.roomId]: summary.visiblePeers
    };
    presence.hiddenPeerCountByRoomId = {
      ...presence.hiddenPeerCountByRoomId,
      [summary.roomId]: summary.hiddenPeerCount
    };
    presence.unreadCountByRoomId = {
      ...presence.unreadCountByRoomId,
      [summary.roomId]: roomChatIsBeingRead(summary.roomId) ? 0 : (summary.unreadCount ?? 0)
    };
  }

  function setRoomUnreadCount(roomId: string, unreadCount: number): void {
    // Read from the raw object so a caller inside an effect does not depend on the counts.
    const current = toRaw(presence).unreadCountByRoomId;
    const nextUnreadCount = Math.max(0, unreadCount);
    if (current[roomId] === nextUnreadCount) return;
    presence.unreadCountByRoomId = {
      ...current,
      [roomId]: nextUnreadCount
    };
  }

  function beginRoomChatReadSession(roomId: string): () => void {
    if (!roomId) return () => {};
    roomChatReadSessions[roomId] = (roomChatReadSessions[roomId] ?? 0) + 1;
    setRoomUnreadCount(roomId, 0);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      roomChatReadSessions[roomId] = Math.max(0, (roomChatReadSessions[roomId] ?? 1) - 1);
    };
  }

  function clearRoomPresence(roomId: string): void {
    const { [roomId]: _peers, ...peersByRoomId } = presence.peersByRoomId;
    const { [roomId]: _hidden, ...hiddenPeerCountByRoomId } = presence.hiddenPeerCountByRoomId;
    const { [roomId]: _unread, ...unreadCountByRoomId } = presence.unreadCountByRoomId;
    presence.peersByRoomId = peersByRoomId;
    presence.hiddenPeerCountByRoomId = hiddenPeerCountByRoomId;
    presence.unreadCountByRoomId = unreadCountByRoomId;
  }

  return {
    ...toRefs(presence),
    applyRoomSummary,
    setRoomUnreadCount,
    beginRoomChatReadSession,
    clearRoomPresence
  };
});
