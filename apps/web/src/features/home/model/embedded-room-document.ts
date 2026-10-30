// The body flags the room's stylesheets key on, while the room embedded in the
// lobby is on screen or hidden behind another lobby view. Hiding takes them
// off; showing must put back every one the room still needs.

import { usePageStore } from '@/stores/page.store';

export function syncEmbeddedRoomDocument(room: { visible: boolean; chatOpen: boolean; streamOnStage: boolean }): void {
  const page = usePageStore();
  if (room.visible) {
    page.screen = 'room';
    page.lobbyEmbedded = true;
    // RoomChat's own effect won't re-fire (chatOpen didn't change), so the
    // stage/dock wouldn't shift back for an already-open chat.
    page.chatOpen = room.chatOpen;
    // A stream still on the stage needs its layout, or its strip falls under the dock.
    if (room.streamOnStage) page.screenView = true;
    return;
  }
  page.screen = 'start';
  page.chatOpen = false;
  page.lobbyEmbedded = false;
  page.screenView = false;
  page.stripCollapsed = false;
}
