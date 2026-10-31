// A guest room dies once empty, so a guest who comes back on another day is
// offered an account with a permanent room before making yet another one. A
// first visit, or a second room the same day, goes straight to the room.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/session.store';
import HomePage from '@/features/home/HomePage.vue';
import { GUEST_ROOM_CREATED_KEY, PERMANENT_ROOM_OFFER_DISMISSED_KEY } from '@/features/home/model/returning-guest';
import { stubFetch } from '../fixtures/fetch';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { authUser } from '../fixtures/users';
import { stubWindow } from '../helpers/fresh-module';
import { stubMatchMedia } from '../helpers/match-media';
import { renderWithApp } from '../helpers/render';

const DAY_MS = 24 * 60 * 60 * 1000;

// What the API answers, in full: the client checks every answer against its contract.
const createRoute = {
  'GET /api/auth/me': { body: { ok: true, user: null } },
  '/api/pow-challenge': { body: { ok: true, required: false } },
  'POST /api/rooms': {
    status: 201,
    body: {
      ok: true,
      roomId: 'tmp123',
      name: '',
      avatarUrl: null,
      createdAt: 1,
      isStatic: false,
      maxRooms: 10,
      maxRoomPeers: 25,
      owned: false
    }
  }
};

// The lobby page loads on demand, after this stub is in place, and the room
// state it imports reads the path.
let location: { href: string; pathname: string };

// The landing page asks for the desktop app's version on its own; only room
// creation matters here.
const roomCalls = (calls: Array<{ url: string }>) =>
  calls.filter((call) => call.url === '/api/rooms' || call.url === '/api/pow-challenge');

beforeEach(() => {
  // jsdom has no modal dialogs.
  for (const [name, open] of [
    ['showModal', true],
    ['close', false]
  ] as const) {
    if (name in HTMLDialogElement.prototype) continue;
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = open;
      }
    });
  }
  localStorage.clear();
  location = { href: 'https://voiceroom.ru/', pathname: '/' };
  stubWindow({ location });
});

async function clickCreate() {
  const app = await renderWithApp(HomePage);
  const session = useSessionStore(app.pinia);
  await userEvent.click(await screen.findByRole('button', { name: /Создать комнату/ }));
  return session;
}

// The lobby is a chunk the page loads on demand; compiling it here keeps that
// one-off cost out of the wait for the lobby to render.
beforeAll(async () => {
  await import('@/features/home/LobbyPage.vue');
});

test('a first room opens at once and is remembered', async () => {
  const { calls } = stubFetch(createRoute);
  await clickCreate();

  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
  expect(screen.queryByRole('dialog', { name: 'Снова нужна комната?' })).toBeNull();
  expect(calls.at(-1)?.body).toMatchObject({ isStatic: false });
  expect(Number(localStorage.getItem(GUEST_ROOM_CREATED_KEY))).toBeGreaterThan(0);
});

test('a guest back on another day is asked first and can go on without an account', async () => {
  localStorage.setItem(GUEST_ROOM_CREATED_KEY, String(Date.now() - 2 * DAY_MS));
  const { calls } = stubFetch(createRoute);
  await clickCreate();

  expect(await screen.findByRole('dialog', { name: 'Снова нужна комната?' })).toBeTruthy();
  expect(roomCalls(calls)).toEqual([]);

  await userEvent.click(screen.getByRole('button', { name: 'Продолжить без аккаунта' }));
  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
  expect(Number(localStorage.getItem(PERMANENT_ROOM_OFFER_DISMISSED_KEY))).toBeGreaterThan(0);
});

test('closing the offer makes no room', async () => {
  localStorage.setItem(GUEST_ROOM_CREATED_KEY, String(Date.now() - 2 * DAY_MS));
  const { calls } = stubFetch(createRoute);
  await clickCreate();

  await userEvent.click(await screen.findByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('dialog', { name: 'Снова нужна комната?' })).toBeNull();
  expect(roomCalls(calls)).toEqual([]);
  expect(location.href).toBe('https://voiceroom.ru/');
});

test('an account made from the offer lands on the new-room dialog, permanent by default', async () => {
  installFakeWebSocket();
  stubMatchMedia();
  localStorage.setItem(GUEST_ROOM_CREATED_KEY, String(Date.now() - 2 * DAY_MS));
  const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада', hasUsedDesktopApp: true });
  const { calls } = stubFetch({
    'GET /api/auth/me': { body: { ok: true, user: null } },
    'POST /api/auth/register': { status: 201, body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const session = await clickCreate();

  await userEvent.click(await screen.findByRole('button', { name: 'Создать аккаунт' }));
  await userEvent.type(screen.getByLabelText('Логин'), 'ada');
  await userEvent.type(screen.getByLabelText('Пароль'), 'password-123');
  await userEvent.type(screen.getByLabelText('Повторите пароль'), 'password-123');
  await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

  const dialog = await screen.findByRole('dialog', { name: 'Новая комната' }, { timeout: 5000 });
  expect(dialog).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Постоянная/ }).getAttribute('aria-selected')).toBe('true');
  expect(calls.find((call) => call.url === '/api/auth/register')?.body).toMatchObject({ login: 'ada' });
  expect(roomCalls(calls)).toEqual([]);

  // Signed out and back in without the offer: the lobby opens bare.
  session.setUser(null);
  expect(await screen.findByRole('button', { name: /Создать комнату/ })).toBeTruthy();
  session.setUser(user);
  await screen.findByRole('button', { name: 'Создать комнату' }, { timeout: 5000 });
  expect(screen.queryByRole('dialog', { name: 'Новая комната' })).toBeNull();
});
