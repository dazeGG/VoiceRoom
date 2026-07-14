import type { RoomPeer } from '$lib/api/rooms';
import type { RoomRealtimeSummary } from '$lib/api/realtime';
import { untrack } from 'svelte';

export const roomPresence = $state<{
  peersByRoomId: Record<string, RoomPeer[]>;
  hiddenPeerCountByRoomId: Record<string, number>;
  unreadCountByRoomId: Record<string, number>;
}>({
  peersByRoomId: {},
  hiddenPeerCountByRoomId: {},
  unreadCountByRoomId: {}
});

const roomChatReadSessions = new Map<string, number>();

function roomChatIsBeingRead(roomId: string): boolean {
  return (roomChatReadSessions.get(roomId) ?? 0) > 0;
}

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
    [summary.roomId]: roomChatIsBeingRead(summary.roomId) ? 0 : (summary.unreadCount ?? 0)
  };
}

export function setRoomUnreadCount(roomId: string, unreadCount: number): void {
  const current = untrack(() => roomPresence.unreadCountByRoomId);
  const nextUnreadCount = Math.max(0, unreadCount);
  if (current[roomId] === nextUnreadCount) return;
  roomPresence.unreadCountByRoomId = {
    ...current,
    [roomId]: nextUnreadCount
  };
}

export function beginRoomChatReadSession(roomId: string): () => void {
  if (!roomId) return () => {};
  roomChatReadSessions.set(roomId, (roomChatReadSessions.get(roomId) ?? 0) + 1);
  setRoomUnreadCount(roomId, 0);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const next = (roomChatReadSessions.get(roomId) ?? 1) - 1;
    if (next > 0) roomChatReadSessions.set(roomId, next);
    else roomChatReadSessions.delete(roomId);
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
