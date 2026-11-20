export interface CallShell {
  roomLeft(roomId: string): void;
  roomsChanged(roomId: string): void;
}

const EMPTY_SHELL: CallShell = { roomLeft: () => {}, roomsChanged: () => {} };

let embeddedRoom = false;
// The room client is not a component, so RoomPage hands it the shell it read
// from context while the room is mounted.
let roomShell: CallShell = EMPTY_SHELL;

export function setRoomEmbedded(value: boolean): void {
  embeddedRoom = value;
}

export function isRoomEmbedded(): boolean {
  return embeddedRoom;
}

export function setRoomShell(shell: CallShell): void {
  roomShell = shell;
}

/** What the room tells the page hosting it (the lobby); does nothing on the standalone route. */
export function getRoomShell(): CallShell {
  return roomShell;
}

export function resetRoomShell(): void {
  roomShell = EMPTY_SHELL;
  embeddedRoom = false;
}
