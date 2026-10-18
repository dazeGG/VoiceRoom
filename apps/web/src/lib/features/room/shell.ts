// What a room tells the page hosting it. The lobby provides it to close a room
// that was left and to refresh its room list; the standalone /r/ route hosts
// no lobby, so nothing there listens.

import { getContext, setContext } from 'svelte';

export interface RoomShell {
  /** The user left this room's call from inside the room (its leave button). */
  roomLeft(roomId: string): void;
  /** The room's entry in the account's room list changed: saved, renamed, removed. */
  roomsChanged(roomId: string): void;
}

export const STANDALONE_ROOM_SHELL: RoomShell = {
  roomLeft: () => {},
  roomsChanged: () => {}
};

const KEY = Symbol('room-shell');

/** Called by the page that hosts rooms (the lobby) during its initialisation. */
export function provideRoomShell(shell: RoomShell): void {
  setContext(KEY, shell);
}

/** The context entry for a room mounted outside the lobby (mount/render `context`). */
export function roomShellContext(shell: RoomShell): Map<symbol, RoomShell> {
  return new Map([[KEY, shell]]);
}

/** Read during a room component's initialisation. */
export function useRoomShell(): RoomShell {
  return getContext<RoomShell | undefined>(KEY) ?? STANDALONE_ROOM_SHELL;
}
