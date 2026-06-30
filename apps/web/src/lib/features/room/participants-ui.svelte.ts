import { state } from './client/core/state.svelte';
import type { Participant } from './client/core/types';

export function getSortedParticipants(): Participant[] {
  return [
    ...(state.self ? [state.self] : []),
    ...[...state.peers.values()].sort((left, right) => left.joinedAt - right.joinedAt)
  ];
}

export function getParticipantCount(): number {
  return getSortedParticipants().length;
}