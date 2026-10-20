// A guest room dies once empty, so a guest who comes back on another day is
// offered an account with a permanent room before making yet another one. A
// first visit, or a second room the same day, goes straight to the room.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import HomePage from '../../src/lib/features/home/HomePage.svelte';
import { session } from '../../src/lib/features/auth/session.svelte';
import {
  GUEST_ROOM_CREATED_KEY,
  PERMANENT_ROOM_OFFER_DISMISSED_KEY
} from '../../src/lib/features/home/model/returning-guest';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubWindow } from '../helpers/fresh-module.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

vi.mock('$app/navigation', () => ({ pushState: vi.fn(), replaceState: vi.fn(), goto: vi.fn(async () => {}) }));

const DAY_MS = 24 * 60 * 60 * 1000;

const createRoute = {
  '/api/pow-challenge': { body: { required: false } },
  'POST /api/rooms': { status: 201, body: { ok: true, roomId: 'tmp123' } }
};

let location: { href: string };

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
  session.user = null;
  session.loaded = true;
  location = { href: 'https://voiceroom.ru/' };
  stubWindow({ location });
});
afterEach(cleanup);

async function clickCreate(): Promise<void> {
  render(HomePage);
  await userEvent.click(screen.getByRole('button', { name: /Создать комнату/ }));
}

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
    'POST /api/auth/register': { status: 201, body: { ok: true, user } },
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  await clickCreate();

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
});
