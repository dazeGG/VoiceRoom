import { STANDALONE_ROOM_SHELL, type RoomShell } from '../../shell';

let embeddedRoom = false;
// The room client is not a component, so RoomPage hands it the shell it read
// from context while the room is mounted.
let roomShell: RoomShell = STANDALONE_ROOM_SHELL;

export function setRoomEmbedded(value: boolean): void {
  embeddedRoom = value;
}

export function isRoomEmbedded(): boolean {
  return embeddedRoom;
}

export function setRoomShell(shell: RoomShell): void {
  roomShell = shell;
}

/** What the room tells the page hosting it (the lobby); does nothing on the standalone route. */
export function getRoomShell(): RoomShell {
  return roomShell;
}
