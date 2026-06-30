export const participantContextMenu = $state({
  open: false,
  peerId: '',
  restoreFocusPeerId: '',
  x: 0,
  y: 0
});

function focusParticipantTile(peerId: string): void {
  if (!peerId) return;
  const tile = document.querySelector<HTMLElement>(`.participant[data-peer-id="${CSS.escape(peerId)}"]`);
  tile?.focus();
}

export function closeParticipantContextMenu(peerId = '', restoreFocus = true): void {
  if (peerId && peerId !== participantContextMenu.peerId) return;
  const focusPeerId = restoreFocus ? participantContextMenu.restoreFocusPeerId : '';
  participantContextMenu.open = false;
  participantContextMenu.peerId = '';
  participantContextMenu.restoreFocusPeerId = '';
  if (restoreFocus && focusPeerId) {
    queueMicrotask(() => focusParticipantTile(focusPeerId));
  }
}

export function openParticipantContextMenu(peerId: string, x: number, y: number): void {
  participantContextMenu.peerId = peerId;
  participantContextMenu.restoreFocusPeerId = peerId;
  participantContextMenu.x = x;
  participantContextMenu.y = y;
  participantContextMenu.open = true;
}