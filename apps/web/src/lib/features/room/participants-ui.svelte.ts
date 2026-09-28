import { state } from './client/core/state.svelte';
import type { Participant } from './client/core/types';

export const participantsUi = $state({
  focusedParticipantId: ''
});

export function toggleParticipantFocus(peerId: string): void {
  participantsUi.focusedParticipantId = participantsUi.focusedParticipantId === peerId ? '' : peerId;
}

export function clearParticipantFocus(): void {
  participantsUi.focusedParticipantId = '';
}

export function getSortedParticipants(): Participant[] {
  return [
    ...(state.self ? [state.self] : []),
    ...[...state.peers.values()].sort((left, right) => left.joinedAt - right.joinedAt)
  ];
}

export function getParticipantCount(): number {
  return getSortedParticipants().length;
}

export function getFocusedParticipant(): Participant | null {
  const focusedId = participantsUi.focusedParticipantId;
  if (!focusedId) return null;
  return getSortedParticipants().find((participant) => participant.id === focusedId) ?? null;
}
