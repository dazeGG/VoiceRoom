// `/` is the public site (apps/site) and the app starts at /app. A navigation
// inside the app to `/` lands on /app, and the site's «Создать комнату»
// (/app?start=room) makes the room without a second click.

import { screen } from '@testing-library/vue';
import { createMemoryHistory } from 'vue-router';
import { beforeAll, expect, test, vi } from 'vitest';
import { takeStartRoomRequest } from '@/features/home/model/start-room-request';
import HomePage from '@/features/home/HomePage.vue';
import MobileStartScreen from '@/features/home/components/MobileStartScreen.vue';
import { isMobileRoute } from '@/platform/mobile-routes';
import { createAppRouter } from '@/router';
import { stubFetch } from '../fixtures/fetch';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';
import { stubWindow } from '../helpers/fresh-module';
import { stubMatchMedia } from '../helpers/match-media';
import { renderWithApp } from '../helpers/render';

const CREATED_ROOM = {
  ok: true,
  roomId: 'tmp123',
  name: '',
  avatarUrl: null,
  createdAt: 1,
  isStatic: false,
  maxRooms: 10,
  maxRoomPeers: 25,
  owned: false
};

beforeAll(async () => {
  await import('@/features/home/LobbyPage.vue');
});

test('a navigation to `/` lands on /app with its query, as an old link or a notification route does', async () => {
  const router = createAppRouter(createMemoryHistory());
  await router.push('/?dm=bob');
  expect(router.currentRoute.value.fullPath).toBe('/app?dm=bob');
  await router.push('/');
  expect(router.currentRoute.value.fullPath).toBe('/app');
  await router.push('/r/abc');
  expect(router.currentRoute.value.params.roomId).toBe('abc');
});

test('a phone may open /app, the room page and the legal pages', () => {
  expect(isMobileRoute('/app')).toBe(true);
  expect(isMobileRoute('/r/[roomId]')).toBe(true);
  expect(isMobileRoute('/login')).toBe(false);
});

test('the start request is taken off the address, other parts of the query stay', async () => {
  const router = createAppRouter(createMemoryHistory());
  await router.push('/app?start=room&auth=login');
  expect(takeStartRoomRequest(router.currentRoute.value, router)).toBe(true);
  await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/app?auth=login'));

  await router.push('/app?start=other');
  expect(takeStartRoomRequest(router.currentRoute.value, router)).toBe(false);
  expect(router.currentRoute.value.fullPath).toBe('/app?start=other');
});

test('a guest who came from the site gets the room at once', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  const { calls } = stubFetch({
    'GET /api/auth/me': { body: { ok: true, user: null } },
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': { status: 201, body: CREATED_ROOM }
  });
  const location = { href: 'https://voiceroom.ru/app' };
  stubWindow({ location });

  await renderWithApp(HomePage, { props: { startRoom: true } });
  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
  expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/rooms')).toHaveLength(1);
});

test('without the request the landing waits for the button', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  const { calls } = stubFetch({ 'GET /api/auth/me': { body: { ok: true, user: null } } });

  await renderWithApp(HomePage);
  expect(await screen.findByRole('button', { name: /Создать комнату/ })).toBeTruthy();
  expect(calls.some((call) => call.url === '/api/rooms')).toBe(false);
});

test('a signed-in visitor who came from the site gets the new-room dialog, no temporary room is made', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  const { calls } = stubFetch({
    'GET /api/auth/me': { body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });

  await renderWithApp(HomePage, { props: { startRoom: true } });
  expect(await screen.findByRole('dialog', { name: 'Новая комната' }, { timeout: 5000 })).toBeTruthy();
  expect(calls.some((call) => call.method === 'POST' && call.url === '/api/rooms')).toBe(false);
});

test('a phone that came from the site gets the room at once', async () => {
  stubFetch({
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': { status: 201, body: CREATED_ROOM }
  });
  const location = { href: 'https://voiceroom.ru/app' };
  stubWindow({ location });

  await renderWithApp(MobileStartScreen, { props: { startRoom: true } });
  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
});
