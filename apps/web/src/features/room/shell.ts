// What a room tells the page hosting it. The lobby provides it to close a room
// that was left and to refresh its room list; the standalone /r/ route hosts
// no lobby, so nothing there listens.

import { inject, provide, type InjectionKey } from 'vue';

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

export const ROOM_SHELL_KEY: InjectionKey<RoomShell> = Symbol('room-shell');

/** Called by the page that hosts rooms (the lobby) during its setup. */
export function provideRoomShell(shell: RoomShell): void {
  provide(ROOM_SHELL_KEY, shell);
}

/** Read during a room component's setup. */
export function useRoomShell(): RoomShell {
  return inject(ROOM_SHELL_KEY, STANDALONE_ROOM_SHELL);
}
