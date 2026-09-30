// The rooms the lobby lists (the account's own and saved rooms), with their
// live peer counts. Realtime room summaries patch the list in place; a
// reconnect or a change elsewhere refetches it.

import { fetchOwnedRooms, type OwnedRoom } from '$lib/api/auth';
import { clearRoomPresence } from '$lib/entities/room/room-presence.svelte';
import { initLobbyRoomRealtime } from '$lib/entities/room/room-realtime';
import { roomDisplayName } from './rooms';

export class LobbyRooms {
  list = $state<OwnedRoom[]>([]);

  #onError: (message: string) => void;

  constructor(onError: (message: string) => void) {
    this.#onError = onError;
  }

  find(roomId: string | null | undefined): OwnedRoom | null {
    return roomId ? (this.list.find((room) => room.roomId === roomId) ?? null) : null;
  }

  /** The room's display name, or its id for a room the list does not have. */
  label(roomId: string): string {
    const room = this.find(roomId);
    return room ? roomDisplayName(room) : roomId;
  }

  refresh = async (): Promise<void> => {
    try {
      this.list = await fetchOwnedRooms();
    } catch (error) {
      this.list = [];
      this.#onError(error instanceof Error && error.message ? error.message : 'Не удалось загрузить комнаты');
    }
  };

  /** This client left `roomId`: one peer fewer until the refetch answers. */
  left(roomId: string | null): void {
    if (!roomId) return;
    this.list = this.list.map((room) =>
      room.roomId === roomId ? { ...room, peers: Math.max(0, (room.peers ?? 0) - 1) } : room
    );
    clearRoomPresence(roomId);
    void this.refresh();
  }

  /** Follows realtime room summaries; returns the teardown. */
  follow(): () => void {
    return initLobbyRoomRealtime(
      (updater) => {
        this.list = updater(this.list);
      },
      () => void this.refresh()
    );
  }
}
