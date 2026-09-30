// The lobby a component is rendered in: LobbyPage provides its LobbyStore
// during initialisation and every lobby component reads it.

import { getContext, setContext } from 'svelte';
import type { LobbyStore } from './lobby.svelte';

const KEY = Symbol('lobby');

export function provideLobby(lobby: LobbyStore): void {
  setContext(KEY, lobby);
}

export function useLobby(): LobbyStore {
  const lobby = getContext<LobbyStore | undefined>(KEY);
  if (!lobby) throw new Error('useLobby() outside a lobby');
  return lobby;
}

/** The context entry for mounting a lobby component on its own (tests). */
export function lobbyContext(lobby: LobbyStore): Map<symbol, LobbyStore> {
  return new Map([[KEY, lobby]]);
}
