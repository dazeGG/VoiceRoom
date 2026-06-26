// Reactive open/closed state for the owner-only room settings dialog, kept
// separate from the vanilla room client (RoomSettingsDialog.svelte owns the
// actual rename/delete network calls) — same split as room-ui.svelte.ts for chat.
// `isOwner` is mirrored here (set once room.ts resolves ownership) because
// the vanilla `state` object is not itself Svelte-reactive — the topbar
// button needs a reactive flag to show/hide.
export const roomSettingsUi = $state<{ isOwner: boolean; open: boolean }>({
  isOwner: false,
  open: false
});

export function openRoomSettings(): void {
  roomSettingsUi.open = true;
}

export function closeRoomSettings(): void {
  roomSettingsUi.open = false;
}
