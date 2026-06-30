import { state } from './client/core/state.svelte';
import type { Participant } from './client/core/types';

export const participantsUi = $state({
  revision: 0
});

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
  return getSortedParticipants().length;
}