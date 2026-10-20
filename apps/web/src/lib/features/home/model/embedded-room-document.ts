// The body flags the room's stylesheets key on, while the room embedded in the
// lobby is on screen or hidden behind another lobby view. Hiding takes them
// off; showing must put back every one the room still needs.

export function syncEmbeddedRoomDocument(
  body: HTMLElement,
  room: { visible: boolean; chatOpen: boolean; streamOnStage: boolean }
): void {
  if (room.visible) {
    body.dataset.screen = 'room';
    body.dataset.lobbyEmbedded = 'true';
    // RoomChat's own effect won't re-fire (chatOpen didn't change), so the
    // stage/dock wouldn't shift back for an already-open chat.
    body.dataset.chatOpen = room.chatOpen ? 'true' : 'false';
    // A stream still on the stage needs its layout, or its strip falls under the dock.
    if (room.streamOnStage) body.dataset.screenView = 'true';
    return;
  }
  body.dataset.screen = 'start';
  delete body.dataset.chatOpen;
  delete body.dataset.lobbyEmbedded;
  delete body.dataset.screenView;
  delete body.dataset.stripCollapsed;
}
