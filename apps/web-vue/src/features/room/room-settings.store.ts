// Reactive open/closed state for the owner-only room settings dialog, kept
// separate from the vanilla room client (RoomSettingsDialog.vue owns the
// actual rename/delete network calls) — same split as room-ui.store.ts for chat.
// `isOwner` is mirrored here (set once room.ts resolves ownership) because
// the vanilla `state` object is not itself reactive for the topbar
// button, which needs a reactive flag to show/hide.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useRoomSettingsStore = defineStore('room-settings', () => {
  const isOwner = ref(false);
  const open = ref(false);
  const deleting = ref(false);

  function openRoomSettings(): void {
    open.value = true;
  }

  function closeRoomSettings(): void {
    open.value = false;
  }

  return { isOwner, open, deleting, openRoomSettings, closeRoomSettings };
});
