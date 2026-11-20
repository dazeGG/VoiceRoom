import { defineStore } from 'pinia';
import { ref } from 'vue';
import { state } from './room-runtime.store';
import type { Participant } from './types';

export const useParticipantsUiStore = defineStore('participants-ui', () => {
  const focusedParticipantId = ref('');

  function toggleParticipantFocus(peerId: string): void {
    focusedParticipantId.value = focusedParticipantId.value === peerId ? '' : peerId;
  }

  function clearParticipantFocus(): void {
    focusedParticipantId.value = '';
  }

  function getSortedParticipants(): Participant[] {
    return [
      ...(state.self ? [state.self] : []),
      ...[...state.peers.values()].sort((left, right) => left.joinedAt - right.joinedAt)
    ];
  }

  function getParticipantCount(): number {
    return getSortedParticipants().length;
  }

  function getFocusedParticipant(): Participant | null {
    const focusedId = focusedParticipantId.value;
    if (!focusedId) return null;
    return getSortedParticipants().find((participant) => participant.id === focusedId) ?? null;
  }

  return {
    focusedParticipantId,
    toggleParticipantFocus,
    clearParticipantFocus,
    getSortedParticipants,
    getParticipantCount,
    getFocusedParticipant
  };
});
