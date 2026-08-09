/**
 * `list` opens from the participant list and the chat header, where audio is not
 * necessarily shared — it carries social actions plus moderation only.
 * `tile` opens from a grid tile, where you are in the same room and can also
 * adjust that person's volume, mute them locally, or cut their microphone.
 */
export type ParticipantMenuVariant = 'list' | 'tile';

export const participantContextMenu = $state({
  open: false,
  peerId: '',
  restoreFocusPeerId: '',
  restoreFocus: null as HTMLElement | null,
  variant: 'tile' as ParticipantMenuVariant,
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
  const focusTarget = restoreFocus ? participantContextMenu.restoreFocus : null;
  participantContextMenu.open = false;
  participantContextMenu.peerId = '';
  participantContextMenu.restoreFocusPeerId = '';
  participantContextMenu.restoreFocus = null;
  if (restoreFocus && focusPeerId) {
    queueMicrotask(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
      else focusParticipantTile(focusPeerId);
    });
  }
}

export function openParticipantContextMenu(
  peerId: string,
  x: number,
  y: number,
  variant: ParticipantMenuVariant = 'tile',
  restoreFocus: HTMLElement | null = null
): void {
  participantContextMenu.peerId = peerId;
  participantContextMenu.restoreFocusPeerId = peerId;
  participantContextMenu.restoreFocus = restoreFocus;
  participantContextMenu.variant = variant;
  participantContextMenu.x = x;
  participantContextMenu.y = y;
  participantContextMenu.open = true;
}
