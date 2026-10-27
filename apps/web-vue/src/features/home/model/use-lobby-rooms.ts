// The rooms the lobby lists (the account's own and saved rooms), with their
// live peer counts. Realtime room summaries patch the list in place; a
// reconnect or a change elsewhere refetches it.

import { ref } from 'vue';
import { fetchOwnedRooms, type OwnedRoom } from '@/api/auth';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { initLobbyRoomRealtime } from '@/entities/room/room-realtime';
import { roomDisplayName } from './rooms';

export function useLobbyRooms(onError: (message: string) => void) {
  const list = ref<OwnedRoom[]>([]);

  function find(roomId: string | null | undefined): OwnedRoom | null {
    return roomId ? (list.value.find((room) => room.roomId === roomId) ?? null) : null;
  }

  /** The room's display name, or its id for a room the list does not have. */
  function label(roomId: string): string {
    const room = find(roomId);
    return room ? roomDisplayName(room) : roomId;
  }

  async function refresh(): Promise<void> {
    try {
      list.value = await fetchOwnedRooms();
    } catch (error) {
      list.value = [];
      onError(error instanceof Error && error.message ? error.message : 'Не удалось загрузить комнаты');
    }
  }

  /** This client left `roomId`: one peer fewer until the refetch answers. */
  function left(roomId: string | null): void {
    if (!roomId) return;
    list.value = list.value.map((room) =>
      room.roomId === roomId ? { ...room, peers: Math.max(0, (room.peers ?? 0) - 1) } : room
    );
    useRoomPresenceStore().clearRoomPresence(roomId);
    void refresh();
  }

  /** Follows realtime room summaries; returns the teardown. */
  function follow(): () => void {
    return initLobbyRoomRealtime(
      (updater) => {
        list.value = updater(list.value);
      },
      () => void refresh()
    );
  }

  return { list, find, label, refresh, left, follow };
}

export type LobbyRooms = ReturnType<typeof useLobbyRooms>;
