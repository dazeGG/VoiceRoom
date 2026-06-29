let embeddedRoom = false;

export function setRoomEmbedded(value: boolean): void {
  embeddedRoom = value;
}

export function isRoomEmbedded(): boolean {
  return embeddedRoom;
}
