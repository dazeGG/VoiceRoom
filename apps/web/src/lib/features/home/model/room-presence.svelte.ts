import type { RoomPeer } from '$lib/api/rooms';
import type { RoomRealtimeSummary } from '$lib/api/realtime';

export const roomPresence = $state<{
  peersByRoomId: Record<string, RoomPeer[]>;
  hiddenPeerCountByRoomId: Record<string, number>;
  unreadCountByRoomId: Record<string, number>;
}>({
  peersByRoomId: {},
  hiddenPeerCountByRoomId: {},
  unreadCountByRoomId: {}
});

export function applyRoomSummary(summary: RoomRealtimeSummary): void {
  roomPresence.peersByRoomId = {
    ...roomPresence.peersByRoomId,
    [summary.roomId]: summary.visiblePeers
  };
  roomPresence.hiddenPeerCountByRoomId = {
    ...roomPresence.hiddenPeerCountByRoomId,
    [summary.roomId]: summary.hiddenPeerCount
  };
  roomPresence.unreadCountByRoomId = {
    ...roomPresence.unreadCountByRoomId,
    [summary.roomId]: summary.unreadCount ?? 0
  };
}

export function setRoomUnreadCount(roomId: string, unreadCount: number): void {
  roomPresence.unreadCountByRoomId = {
    ...roomPresence.unreadCountByRoomId,
    [roomId]: Math.max(0, unreadCount)
  };
}

export function setRoomPresence(roomId: string, peers: RoomPeer[], hiddenPeerCount = 0): void {
  roomPresence.peersByRoomId = { ...roomPresence.peersByRoomId, [roomId]: peers };
  roomPresence.hiddenPeerCountByRoomId = {
    ...roomPresence.hiddenPeerCountByRoomId,
    [roomId]: hiddenPeerCount
  };
}

export function clearRoomPresence(roomId: string): void {
  const { [roomId]: _peers, ...peersByRoomId } = roomPresence.peersByRoomId;
  const { [roomId]: _hidden, ...hiddenPeerCountByRoomId } = roomPresence.hiddenPeerCountByRoomId;
  const { [roomId]: _unread, ...unreadCountByRoomId } = roomPresence.unreadCountByRoomId;
  roomPresence.peersByRoomId = peersByRoomId;
  roomPresence.hiddenPeerCountByRoomId = hiddenPeerCountByRoomId;
  roomPresence.unreadCountByRoomId = unreadCountByRoomId;
}
