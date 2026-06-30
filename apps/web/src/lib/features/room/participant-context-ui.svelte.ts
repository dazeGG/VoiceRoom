export const participantContextMenu = $state({
  open: false,
  peerId: '',
  x: 0,
  y: 0
});

export function closeParticipantContextMenu(peerId = ''): void {
  if (peerId && peerId !== participantContextMenu.peerId) return;
  participantContextMenu.open = false;
  participantContextMenu.peerId = '';
}

export function openParticipantContextMenu(peerId: string, x: number, y: number): void {
  participantContextMenu.peerId = peerId;
  participantContextMenu.x = x;
  participantContextMenu.y = y;
  participantContextMenu.open = true;
}