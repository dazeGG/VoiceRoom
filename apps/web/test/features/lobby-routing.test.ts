// The lobby's address: a load on /r/:id goes back into that room's voice, ?dm=
// and mention links open what they point at and give the bare address back,
// the back button follows the address, and entering voice while a call runs
// elsewhere asks first.

import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLobbyRouting } from '../../src/features/home/model/use-lobby-routing.ts';
import type { LobbyMode } from '../../src/features/home/model/lobby.store.ts';
import { useRoomNavigationStore } from '../../src/features/home/model/room-navigation.store.ts';
import { ROOM_SWITCH_CONFIRM_STORAGE_KEY } from '../../src/features/home/model/room-switch-confirmation.ts';
import { useVoiceSessionStore } from '../../src/features/room/voice-session.store.ts';
import { usePageStore } from '../../src/stores/page.store.ts';
import { spyOnPush, spyOnReplace } from '../helpers/router-spies.ts';

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }]
  });
  return { router, push: spyOnPush(router), replace: spyOnReplace(router) };
}

let roomNavigation: ReturnType<typeof useRoomNavigationStore>;
let voiceSession: ReturnType<typeof useVoiceSessionStore>;
let navigation: ReturnType<typeof makeRouter>;

function setup(path = '/') {
  window.history.replaceState(null, '', path);
  const lobby: { mode: LobbyMode; openDm: (userId: string) => Promise<void>; showHome: () => void } = {
    mode: 'friends',
    openDm: vi.fn(async () => {}),
    showHome: vi.fn()
  };
  const rooms = { left: vi.fn<(roomId: string | null) => void>() };
  const routing = useLobbyRouting(lobby, rooms, navigation.router);
  return { lobby, rooms, routing };
}

let teardown = (): void => {};

beforeEach(() => {
  setActivePinia(createPinia());
  roomNavigation = useRoomNavigationStore();
  voiceSession = useVoiceSessionStore();
  navigation = makeRouter();
  // A browser with no desktop app to offer, so a room link joins right here.
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
});

afterEach(() => {
  teardown();
  teardown = () => {};
  voiceSession.roomId = null;
  roomNavigation.clearEmbeddedRoom();
  roomNavigation.clearViewedRoom();
  localStorage.removeItem(ROOM_SWITCH_CONFIRM_STORAGE_KEY);
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

test('a page opened on /r/:id goes back into that room and joins its voice', () => {
  const { lobby, routing } = setup('/r/abc123');
  teardown = routing.start();

  expect(lobby.mode).toBe('rooms');
  expect(roomNavigation.viewedRoomId).toBe('abc123');
  expect(roomNavigation.joinIntentRoomId).toBe('abc123');
});

test('a ?dm= link opens that conversation and gives the bare address back', () => {
  const { lobby, routing } = setup('/?dm=bob');
  teardown = routing.start();

  expect(lobby.openDm).toHaveBeenCalledWith('bob');
  expect(navigation.replace).toHaveBeenCalledWith('/');
});

test('a mention link previews its room on that message without joining voice', () => {
  const { lobby, routing } = setup('/?room=abc123&message=m1');
  teardown = routing.start();

  expect(lobby.mode).toBe('rooms');
  expect(roomNavigation.viewedRoomId).toBe('abc123');
  expect(roomNavigation.joinIntentRoomId).toBeNull();
  expect(routing.previewAnchor.value).toEqual({ roomId: 'abc123', messageId: 'm1' });
  expect(navigation.replace).toHaveBeenCalledWith('/');
});

test('the back button shows the room in the address, until the routing stops', () => {
  const { lobby, routing } = setup('/');
  const stop = routing.start();

  window.history.replaceState(null, '', '/r/xyz789');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(lobby.mode).toBe('rooms');
  expect(roomNavigation.viewedRoomId).toBe('xyz789');

  stop();
  window.history.replaceState(null, '', '/r/other1');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(roomNavigation.viewedRoomId).toBe('xyz789');
});

test('entering a room with no call running goes straight in and puts the room in the address', () => {
  const { lobby, routing } = setup('/');

  routing.requestEnterRoom('abc123');

  expect(routing.pendingRoomSwitchId.value).toBe('');
  expect(lobby.mode).toBe('rooms');
  expect(roomNavigation.joinIntentRoomId).toBe('abc123');
  expect(navigation.push).toHaveBeenCalledWith('/r/abc123');
});

test('entering another room during a call asks first; cancelling stays, confirming switches', () => {
  const { routing } = setup('/');
  voiceSession.roomId = 'live01';

  routing.requestEnterRoom('abc123');
  expect(routing.pendingRoomSwitchId.value).toBe('abc123');
  expect(navigation.push).not.toHaveBeenCalled();

  routing.resolveRoomSwitch(false);
  expect(routing.pendingRoomSwitchId.value).toBe('');
  expect(navigation.push).not.toHaveBeenCalled();

  routing.requestEnterRoom('abc123');
  routing.resolveRoomSwitch(true);
  expect(roomNavigation.joinIntentRoomId).toBe('abc123');
  expect(navigation.push).toHaveBeenCalledWith('/r/abc123');
});

test('going home closes the room on screen and shows the call room in the address', () => {
  const { lobby, routing } = setup('/');
  voiceSession.roomId = 'live01';
  routing.previewRoom('abc123');
  expect(roomNavigation.viewedRoomId).toBe('abc123');

  routing.goHome();

  expect(lobby.showHome).toHaveBeenCalled();
  expect(roomNavigation.viewedRoomId).toBeNull();
  expect(navigation.replace).toHaveBeenLastCalledWith('/r/live01');
});

test('a room left from its own button is dropped from the lobby and from the screen', () => {
  const { rooms, routing } = setup('/r/abc123');
  teardown = routing.start();

  routing.closeLeftRoom('abc123');

  expect(rooms.left).toHaveBeenCalledWith('abc123');
  expect(roomNavigation.viewedRoomId).toBeNull();
  expect(roomNavigation.embeddedRoomId).toBeNull();
  expect(usePageStore().screen).toBe('start');
  expect(navigation.replace).toHaveBeenCalledWith('/');
});
