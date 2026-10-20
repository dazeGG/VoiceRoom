// The rooms tab of the admin panel: who is in which room's voice now (an
// account by its name and login, a guest by the name it gave), refreshed every
// few seconds; an account opens its card; the history of finished stays loads
// a page at a time and narrows to one room; the tab has its own address.

import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LiveRoom, LiveRooms, RoomHistory, RoomStay } from '@voice-room/shared/contracts/admin';
import AdminPanel from '../../src/lib/features/admin/AdminPanel.svelte';
import { adminLocationFromPath, adminPath } from '../../src/lib/features/admin/tabs';

const MINUTE = 60_000;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const alice = {
  id: 'u-alice',
  login: 'alice',
  displayName: 'Алиса',
  avatarUrl: null,
  avatarColorKey: 'blurple',
  avatarAccent: null
};

function kitchen(): LiveRoom {
  return {
    roomId: 'kitchen',
    name: 'Кухня',
    isStatic: true,
    avatarUrl: null,
    owner: alice,
    since: Date.now() - 30 * MINUTE,
    peers: [
      {
        peerId: 'p-alice',
        name: 'Алиса',
        account: alice,
        avatarColorKey: 'blurple',
        joinedAt: Date.now() - 30 * MINUTE,
        muted: true,
        deafened: false,
        screen: false,
        client: 'desktop_app'
      },
      {
        peerId: 'p-guest',
        name: 'Петя',
        account: null,
        avatarColorKey: 'green',
        joinedAt: Date.now() - 5 * MINUTE,
        muted: false,
        deafened: false,
        screen: true,
        client: 'mobile'
      }
    ]
  };
}

function stay(id: string, overrides: Partial<RoomStay> = {}): RoomStay {
  return {
    id,
    roomId: 'kitchen',
    roomName: 'Кухня',
    isStatic: true,
    account: null,
    joinedAt: Date.now() - 2 * 60 * MINUTE,
    leftAt: Date.now() - 60 * MINUTE,
    ...overrides
  };
}

type Reply = { status?: number; body: unknown };

/** Answers by "METHOD /path" and records every URL asked for. */
function stubApi(routes: Record<string, (url: URL) => Reply>) {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
      urls.push(url);
      const route = routes[`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`];
      const reply = route ? route(url) : { status: 500, body: { ok: false } };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' }
      });
    })
  );
  return urls;
}

const live = (rooms: LiveRoom[]): Reply => ({ body: { ok: true, rooms } satisfies LiveRooms });
const history = (stays: RoomStay[], next: string | null = null): Reply => ({
  body: { ok: true, stays, next, keepDays: 90 } satisfies RoomHistory
});

test('the tab shows who is in voice now, accounts by login and guests by name, and an account opens its card', async () => {
  const urls = stubApi({
    'GET /api/admin/rooms': () => live([kitchen()]),
    'GET /api/admin/rooms/history': () => history([]),
    'GET /api/admin/accounts/u-alice': () => ({ status: 404, body: { ok: false, error: 'нет' } })
  });
  render(AdminPanel, { props: { tab: 'rooms' } });

  const card = (await screen.findByRole('button', { name: 'Кухня' })).closest('li')!;
  const people = within(card).getAllByRole('listitem');
  expect(people).toHaveLength(2);
  expect(within(people[0]).getByText('@alice')).toBeTruthy();
  expect(within(people[0]).getByLabelText('Микрофон выключен')).toBeTruthy();
  expect(within(people[1]).getByText('Петя')).toBeTruthy();
  expect(within(people[1]).getByText('гость')).toBeTruthy();
  expect(within(people[1]).getByLabelText('Показывает экран')).toBeTruthy();
  // Where each one sits: the desktop app, a phone or a browser.
  expect(within(people[0]).getByText('приложение')).toBeTruthy();
  expect(within(people[1]).getByText('телефон')).toBeTruthy();
  expect(within(card).getByText('постоянная')).toBeTruthy();
  expect(screen.getByText(/комнат: 1, людей: 2/)).toBeTruthy();
  expect(await screen.findByText('Завершённых звонков пока нет.')).toBeTruthy();

  await userEvent.click(within(people[0]).getByRole('button', { name: /Алиса/ }));
  await waitFor(() => expect(urls.some((url) => url.pathname === '/api/admin/accounts/u-alice')).toBe(true));
  expect(screen.getByRole('tab', { name: 'Аккаунты' }).getAttribute('aria-selected')).toBe('true');
});

test('the list of who is in voice refreshes every few seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let rooms: LiveRoom[] = [kitchen()];
  stubApi({
    'GET /api/admin/rooms': () => live(rooms),
    'GET /api/admin/rooms/history': () => history([])
  });
  render(AdminPanel, { props: { tab: 'rooms' } });
  expect(await screen.findByText('Петя')).toBeTruthy();

  rooms = [];
  await vi.advanceTimersByTimeAsync(5000);
  expect(await screen.findByText('Сейчас никто не в звонке.')).toBeTruthy();
});

test('an unnamed temporary room that is still there goes by its code and is not marked deleted', async () => {
  stubApi({
    'GET /api/admin/rooms': () => live([]),
    'GET /api/admin/rooms/history': () => history([stay('s-tmp', { roomId: '8vjx8udrdu', roomName: '', isStatic: false })])
  });
  render(AdminPanel, { props: { tab: 'rooms' } });

  const table = await screen.findByRole('table');
  expect(within(table).getByRole('button', { name: '8vjx8udrdu' })).toBeTruthy();
  expect(within(table).queryByText('удалена')).toBeNull();
});

test('the history loads a page at a time and narrows to one room', async () => {
  const pageOne = Array.from({ length: 3 }, (_, index) => stay(`s-${index}`));
  const urls = stubApi({
    'GET /api/admin/rooms': () => live([kitchen()]),
    'GET /api/admin/rooms/history': (url) => {
      if (url.searchParams.get('after') === 'cursor-1') return history([stay('s-old', { account: alice })]);
      if (url.searchParams.get('roomId') === 'gone')
        return history([stay('s-gone', { roomId: 'gone', roomName: null })]);
      if (url.searchParams.get('roomId') === 'kitchen') return history([stay('s-kitchen')]);
      return history([...pageOne, stay('s-gone', { roomId: 'gone', roomName: null })], 'cursor-1');
    }
  });
  render(AdminPanel, { props: { tab: 'rooms' } });

  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(1 + 4);
  // A temporary room is gone once empty: its row shows the code it was called by.
  expect(within(table).getByRole('button', { name: 'gone' })).toBeTruthy();
  expect(within(table).getByText('удалена')).toBeTruthy();

  // The next page replaces this one; going back asks for the first page again.
  expect(screen.getByRole('button', { name: 'Назад' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + 1));
  expect(within(screen.getByRole('table')).getByText('@alice')).toBeTruthy();
  expect(screen.getByText('Страница 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Дальше' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }));
  await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + 4));
  expect(urls.at(-1)?.searchParams.has('after')).toBe(false);
  expect(screen.getByText('Страница 1')).toBeTruthy();

  // A live room's name narrows the list; the chip takes it back to every room.
  await userEvent.click(
    within(screen.getByRole('list', { name: 'Сейчас в звонках' })).getByRole('button', { name: 'Кухня' })
  );
  await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2));
  expect(urls.at(-1)?.searchParams.get('roomId')).toBe('kitchen');
  await userEvent.click(screen.getByRole('button', { name: /Показать все комнаты/ }));
  await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + 4));
  expect(urls.at(-1)?.searchParams.has('roomId')).toBe(false);

  // So does a room in the history, a gone one too.
  await userEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'gone' }));
  await waitFor(() => expect(urls.at(-1)?.searchParams.get('roomId')).toBe('gone'));
});

test('a stay shows when it ended next to when it began, and its length in hours and minutes', async () => {
  const joinedAt = new Date(2026, 9, 15, 14, 30).getTime();
  stubApi({
    'GET /api/admin/rooms': () => live([]),
    'GET /api/admin/rooms/history': () =>
      history([
        stay('s-long', { joinedAt, leftAt: joinedAt + 85 * MINUTE }),
        stay('s-night', { joinedAt: joinedAt + 9 * 60 * MINUTE, leftAt: joinedAt + 10 * 60 * MINUTE })
      ])
  });
  render(AdminPanel, { props: { tab: 'rooms' } });

  const [, long, night] = within(await screen.findByRole('table')).getAllByRole('row');
  expect(within(long).getByText('15 окт., 14:30 – 15:55')).toBeTruthy();
  expect(within(long).getByText('1 ч 25 мин')).toBeTruthy();
  // Past midnight the end carries its own date.
  expect(within(night).getByText('15 окт., 23:30 – 16 окт., 00:30')).toBeTruthy();
  expect(within(night).getByText('1 ч')).toBeTruthy();
});

test('the rooms tab has its own address', () => {
  expect(adminPath('rooms')).toBe('/admin/rooms');
  expect(adminLocationFromPath('/admin/rooms')).toEqual({ tab: 'rooms', accountId: null });
});
