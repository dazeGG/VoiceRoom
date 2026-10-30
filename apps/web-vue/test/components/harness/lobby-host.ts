// Test component: a lobby view inside the lobby it reads (LobbyPage provides it in the app).

import { defineComponent, h, type Component } from 'vue';
import { provideLobby } from '@/features/home/model/lobby-context';
import { useLobbyStore } from '@/features/home/model/lobby.store';

/** A component rendering `view` with `props`, under a lobby store of the active Pinia. */
export function lobbyHost(view: Component, props: Record<string, unknown> = {}) {
  return defineComponent(() => {
    provideLobby(useLobbyStore());
    return () => h(view, props);
  });
}
