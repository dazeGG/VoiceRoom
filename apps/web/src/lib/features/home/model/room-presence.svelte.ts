import { fetchRoomPeers, type RoomPeer } from '$lib/api/rooms';

export const roomPresence = $state<{
  peersByRoomId: Record<string, RoomPeer[]>;
}>({
  peersByRoomId: {}
});

export async function refreshRoomPresence(roomId: string): Promise<RoomPeer[]> {
  const peers = await fetchRoomPeers(roomId);
  roomPresence.peersByRoomId = { ...roomPresence.peersByRoomId, [roomId]: peers };
  return peers;
}

export function setRoomPresence(roomId: string, peers: RoomPeer[]): void {
  roomPresence.peersByRoomId = { ...roomPresence.peersByRoomId, [roomId]: peers };
}
