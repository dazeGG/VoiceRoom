// The lobby a component is rendered in: LobbyPage provides its lobby store
// during setup and every lobby component reads it.

import { inject, provide, type InjectionKey } from 'vue';
import type { LobbyStore } from './lobby.store';

export const LOBBY_KEY: InjectionKey<LobbyStore> = Symbol('lobby');

export function provideLobby(lobby: LobbyStore): void {
  provide(LOBBY_KEY, lobby);
}

export function useLobby(): LobbyStore {
  const lobby = inject(LOBBY_KEY, undefined);
  if (!lobby) throw new Error('useLobby() outside a lobby');
  return lobby;
}
