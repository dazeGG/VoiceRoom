import type { RoomPeer } from '$lib/api/rooms';
import type { RoomRealtimeSummary } from '$lib/api/realtime';

export const roomPresence = $state<{
  peersByRoomId: Record<string, RoomPeer[]>;
  hiddenPeerCountByRoomId: Record<string, number>;
}>({
  peersByRoomId: {},
  hiddenPeerCountByRoomId: {}
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
  roomPresence.peersByRoomId = peersByRoomId;
  roomPresence.hiddenPeerCountByRoomId = hiddenPeerCountByRoomId;
}