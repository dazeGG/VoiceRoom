import { state } from './client/core/state.svelte';
import type { Participant } from './client/core/types';

export const participantsUi = $state({
  revision: 0,
  focusedParticipantId: ''
});

export function toggleParticipantFocus(peerId: string): void {
  participantsUi.focusedParticipantId = participantsUi.focusedParticipantId === peerId ? '' : peerId;
}

export function clearParticipantFocus(): void {
  participantsUi.focusedParticipantId = '';
}

export function bumpParticipantsRevision(): void {
  participantsUi.revision += 1;
}

export function getSortedParticipants(): Participant[] {
  void participantsUi.revision;
  return [
    ...(state.self ? [state.self] : []),
    ...[...state.peers.values()].sort((left, right) => left.joinedAt - right.joinedAt)
  ];
}

export function getParticipantCount(): number {
  void participantsUi.revision;
  return getSortedParticipants().length;
}

export function getFocusedParticipant(): Participant | null {
  const focusedId = participantsUi.focusedParticipantId;
  if (!focusedId) return null;
  return getSortedParticipants().find((participant) => participant.id === focusedId) ?? null;
}
