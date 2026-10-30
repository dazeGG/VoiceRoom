// The lobby's address on a real browser history: the router writes entries
// after its guards, so the address the lobby reads may lag behind the route.
// The back button inside the lobby ends on the room the call is in, as
// SvelteKit's synchronous replaceState did, and a back button out of the lobby
// is left alone.

import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLobbyRouting } from '../../src/features/home/model/use-lobby-routing.ts';
import type { LobbyMode } from '../../src/features/home/model/lobby.store.ts';
import { useRoomNavigationStore } from '../../src/features/home/model/room-navigation.store.ts';
import { ROOM_SWITCH_CONFIRM_STORAGE_KEY } from '../../src/features/home/model/room-switch-confirmation.ts';
import { useVoiceSessionStore } from '../../src/features/room/voice-session.store.ts';
import { isShallowEntry } from '../../src/shared/utils/shallow-routing.ts';

let router: Router;
let voiceSession: ReturnType<typeof useVoiceSessionStore>;
let stop = (): void => {};

async function openAt(...paths: string[]) {
  window.history.replaceState(null, '', '/');
  router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }]
  });
  for (const path of paths) await router.push(path);
  await router.isReady();
  const lobby: { mode: LobbyMode; openDm: (userId: string) => Promise<void>; showHome: () => void } = {
    mode: 'friends',
    openDm: vi.fn(async () => {}),
    showHome: vi.fn()
  };
  const routing = useLobbyRouting(lobby, { left: vi.fn() }, router);
  stop = routing.start();
  return routing;
}

/** The address and the route both settle on `path`. */
async function settlesOn(path: string): Promise<void> {
  await vi.waitFor(() => {
    expect(window.location.pathname).toBe(path);
    expect(router.currentRoute.value.path).toBe(path);
  });
  // Nothing still running moves it afterwards.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(window.location.pathname).toBe(path);
  expect(router.currentRoute.value.path).toBe(path);
}

function back(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  voiceSession = useVoiceSessionStore();
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
});

afterEach(() => {
  stop();
  stop = () => {};
  voiceSession.roomId = null;
  localStorage.removeItem(ROOM_SWITCH_CONFIRM_STORAGE_KEY);
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

test('the back button home during a call keeps the call room in the address', async () => {
  const routing = await openAt('/');
  routing.requestEnterRoom('abc123');
  await settlesOn('/r/abc123');
  voiceSession.roomId = 'abc123';

  await back();

  await settlesOn('/r/abc123');
  expect(isShallowEntry('/r/abc123')).toBe(true);
});

test('the back button to the previous room after a switch keeps the room the call moved to', async () => {
  const routing = await openAt('/');
  routing.requestEnterRoom('abc123');
  await settlesOn('/r/abc123');
  voiceSession.roomId = 'abc123';
  routing.requestEnterRoom('xyz789');
  routing.resolveRoomSwitch(true);
  await settlesOn('/r/xyz789');
  voiceSession.roomId = 'xyz789';

  await back();

  await settlesOn('/r/xyz789');
  expect(useRoomNavigationStore().viewedRoomId).toBe('abc123');
});

test('the back button out of the lobby goes to that page', async () => {
  await openAt('/login', '/');

  await back();

  await settlesOn('/login');
});
