import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

/**
 * `list` opens from the participant list and the chat header, where audio is not
 * necessarily shared — it carries social actions plus moderation only.
 * `tile` opens from a grid tile, where you are in the same room and can also
 * adjust that person's volume, mute them locally, or cut their microphone.
 */
export type ParticipantMenuVariant = 'list' | 'tile';

function focusParticipantTile(peerId: string): void {
  if (!peerId) return;
  const tile = document.querySelector<HTMLElement>(`.participant[data-peer-id="${CSS.escape(peerId)}"]`);
  tile?.focus();
}

export const useParticipantContextUiStore = defineStore('participant-context-ui', () => {
  const open = ref(false);
  const peerId = ref('');
  const restoreFocusPeerId = ref('');
  const restoreFocus = shallowRef<HTMLElement | null>(null);
  const variant = ref<ParticipantMenuVariant>('tile');
  const x = ref(0);
  const y = ref(0);

  function closeParticipantContextMenu(closingPeerId = '', restoreFocusOnClose = true): void {
    if (closingPeerId && closingPeerId !== peerId.value) return;
    const focusPeerId = restoreFocusOnClose ? restoreFocusPeerId.value : '';
    const focusTarget = restoreFocusOnClose ? restoreFocus.value : null;
    open.value = false;
    peerId.value = '';
    restoreFocusPeerId.value = '';
    restoreFocus.value = null;
    if (restoreFocusOnClose && focusPeerId) {
      queueMicrotask(() => {
        if (focusTarget?.isConnected) focusTarget.focus();
        else focusParticipantTile(focusPeerId);
      });
    }
  }

  function openParticipantContextMenu(
    openedPeerId: string,
    left: number,
    top: number,
    menuVariant: ParticipantMenuVariant = 'tile',
    restoreFocusTo: HTMLElement | null = null
  ): void {
    peerId.value = openedPeerId;
    restoreFocusPeerId.value = openedPeerId;
    restoreFocus.value = restoreFocusTo;
    variant.value = menuVariant;
    x.value = left;
    y.value = top;
    open.value = true;
  }

  return {
    open,
    peerId,
    restoreFocusPeerId,
    restoreFocus,
    variant,
    x,
    y,
    closeParticipantContextMenu,
    openParticipantContextMenu
  };
});
