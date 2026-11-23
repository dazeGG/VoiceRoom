// The /r/<id> route for a signed-in visit renders the lobby, which hosts the
// profile card. The route once mounted a second host beside it: both opened on
// the shared card state, the second took focus, and the first closed them both.

import { fireEvent, screen } from '@testing-library/vue';
import { nextTick } from 'vue';
import { beforeAll, expect, test, vi } from 'vitest';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import App from '@/App.vue';
import * as desktopCall from '@/platform/desktop-call';
import * as desktopBoundary from '../../src/platform/desktop-boundary';
import * as openInApp from '../../src/platform/open-in-app';
import { useLocaleStore } from '../../src/shared/i18n';
import { french } from '../../src/shared/i18n/catalog';
import RoomRoute from '../../src/pages/RoomRoute.vue';
import { useProfileCardUiStore } from '../../src/entities/profile-card/profile-card-ui.store.ts';
import { useSessionStore } from '../../src/features/auth/session.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { defined } from '../helpers/assert.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render.ts';

// The room page loads the call engine on demand and mounts it into its shell.
// These tests are about the route and the shell, not the call: the engine needs
// the call ports the app's composition root installs, so it is a stand-in here
// that records each mount.
const engine = vi.hoisted(() => ({ mountRoomClient: vi.fn(() => () => {}) }));
vi.mock('@voiceroom/call/engine/main', () => engine);

// The lobby is a chunk the route loads on demand; compiling it here keeps that
// one-off cost out of the wait for the lobby to render.
beforeAll(async () => {
  await import('../../src/features/home/LobbyPage.vue');
});

test.each([false, true])('the desktop call bridge follows join and leave (signed in: %s)', async (signedIn) => {
  installFakeWebSocket();
  stubMatchMedia();
  stubOverlayDom();
  const setState = vi.fn(async () => {});
  vi.stubGlobal('voiceRoomDesktopCall', { setState });
  const publisher = vi.spyOn(desktopCall, 'syncDesktopCallState');
  const user = signedIn ? authUser({ id: 'ada', login: 'ada', displayName: 'Ада' }) : null;
  stubFetch({
    'GET /api/auth/me': { body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const { pinia } = await renderWithApp(App, {
    route: '/r/room-1',
    extraRoutes: [{ path: '/r/:roomId', component: RoomRoute, props: true }]
  });
  try {
    if (signedIn) await screen.findByRole('button', { name: 'Создать комнату' }, { timeout: 5000 });
    else await vi.waitFor(() => expect(engine.mountRoomClient).toHaveBeenCalled());
    const voiceSession = useVoiceSessionStore(pinia);
    voiceSession.setConnectedVoiceRoom('room-1');
    await vi.waitFor(() =>
      expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, roomId: 'room-1' }))
    );
    expect(publisher.mock.calls.filter(([state]) => state.active)).toHaveLength(1);
    voiceSession.clearConnectedVoiceRoom('room-1');
    await vi.waitFor(() => expect(setState).toHaveBeenLastCalledWith({ active: false }));
  } finally {
    publisher.mockRestore();
  }
});

test('a signed-in room link opens exactly one profile card, and it stays open', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  stubFetch({
    'GET /api/auth/me': { body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });

  await renderWithApp(RoomRoute, { props: { roomId: 'room-1' }, route: '/r/room-1' });
  expect(await screen.findByRole('button', { name: 'Создать комнату' }, { timeout: 5000 })).toBeTruthy();

  const anchor = document.createElement('button');
  document.body.append(anchor);
  useProfileCardUiStore().openProfileCardFor(
    {
      userId: 'bob',
      name: 'Боб',
      login: 'bob',
      avatarUrl: null,
      avatarColorKey: 'blue',
      avatarAccent: null,
      presence: 'online'
    },
    anchor
  );
  await screen.findByRole('dialog', { name: 'Профиль Боб' });
  for (let i = 0; i < 5; i += 1) await nextTick();

  expect(screen.getAllByRole('dialog', { name: 'Профиль Боб' })).toHaveLength(1);
});

test('returning to the tab preserves the mounted room after choosing to continue in the browser', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  stubOverlayDom();
  const offer = vi.spyOn(openInApp, 'shouldOfferOpenInApp').mockReturnValue(true);
  const launch = vi.spyOn(openInApp, 'launchAppLink').mockImplementation(() => {});
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const previousUrl = window.location.href;
  window.history.replaceState(null, '', '/r/room-1');
  const user = authUser();
  let verifiedUser = user;
  const { fetchMock } = stubFetch({
    'GET /api/auth/me': () => ({ body: { ok: true, user: verifiedUser } }),
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });

  try {
    const { container, pinia } = await renderWithApp(RoomRoute, { props: { roomId: 'room-1' }, route: '/r/room-1' });
    const continueButton = await screen.findByRole('button', { name: 'Продолжить в браузере' });
    await fireEvent.click(continueButton);
    const room = defined(container.querySelector('.room-embedded-shell'), 'mounted room');
    await vi.waitFor(() => expect(engine.mountRoomClient).toHaveBeenCalledOnce());
    const session = useSessionStore(pinia);
    expect(session.user?.id).toBe(user.id);
    const sessionCheck = Promise.withResolvers<void>();
    const fetchRoute = defined(fetchMock.getMockImplementation(), 'fetch fixture');
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/auth/me') await sessionCheck.promise;
      return fetchRoute(input, init);
    });

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    expect(room.isConnected).toBe(true);

    verifiedUser = { ...user, displayName: 'Обновлён' };
    sessionCheck.resolve();
    await vi.waitFor(() => expect(session.user?.displayName).toBe(verifiedUser.displayName));
    await nextTick();
    expect(container.querySelector('.room-embedded-shell')).toBe(room);
    expect(screen.queryByRole('button', { name: 'Продолжить в браузере' })).toBeNull();
    expect(launch).toHaveBeenCalledOnce();
    expect(engine.mountRoomClient).toHaveBeenCalledOnce();
  } finally {
    window.history.replaceState(null, '', previousUrl);
    offer.mockRestore();
    launch.mockRestore();
    visibility.mockRestore();
  }
});

test('unsupported room route kicker follows the active client language', async () => {
  const policy = desktopBoundary.resolveDesktopBoundaryPolicy();
  const boundary = vi
    .spyOn(desktopBoundary, 'applyDesktopBoundaryToDocument')
    .mockReturnValue({ ...policy, desktopAllowed: false, roomClientAllowed: false });
  try {
    const { pinia } = await renderWithApp(RoomRoute, { props: { roomId: 'room-1' } });
    const locale = useLocaleStore(pinia);
    expect(screen.getByText('Только для компьютера')).toBeTruthy();
    await locale.select('en');
    await nextTick();
    expect(screen.getByText('Desktop only')).toBeTruthy();
    await locale.select('fr');
    await nextTick();
    expect(screen.getByText(french['Только для компьютера'])).toBeTruthy();
  } finally {
    boundary.mockRestore();
  }
});
