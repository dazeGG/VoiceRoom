// The admin app's frame: the menu opens the sections a role may see, in their
// groups, starts on the first of them when the address names another, and
// counts the open reports for those who review them; it folds and keeps that;
// the top bar says where you are, how fresh the numbers are and asks again on
// a click; the search finds accounts and rooms and opens them.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AccountDetail, AccountRow, LiveRoom } from '@voice-room/shared/contracts/admin';
import type { AdminReport } from '@voice-room/shared/contracts/reports';
import type { StaffRole } from '@voice-room/shared/contracts/staff';
import { App } from '../src/App.tsx';
import { stubChartBox } from './helpers/chart-box.ts';
import { staffOf, stubApi, type Route } from './helpers/harness.tsx';

let restoreChartBox = () => {};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  restoreChartBox = stubChartBox();
});
afterEach(() => {
  cleanup();
  restoreChartBox();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function report(id: string): AdminReport {
  return {
    id,
    reason: 'spam',
    comment: '',
    createdAt: 1,
    reporter: { userId: 'u-1', login: 'one', displayName: 'Один' },
    target: {
      kind: 'direct_message',
      messageId: `m-${id}`,
      roomId: null,
      roomName: null,
      authorUserId: 'u-2',
      authorName: 'Два',
      text: 'текст',
      sentAt: 1,
      deleted: false
    }
  };
}

function alice(): AccountRow {
  return {
    id: 'u-alice',
    login: 'alice',
    displayName: 'Алиса',
    avatarUrl: null,
    avatarColorKey: 'blurple',
    avatarAccent: null,
    createdAt: Date.now() - 86_400_000,
    lastSeenAt: Date.now(),
    activeDays: 1,
    clients: { desktopApp: false, browser: true, mobile: false },
    voiceMinutes: 0,
    messages: 0,
    ownedRooms: 0,
    reportsAgainst: 0,
    online: true,
    admin: false,
    badge: null,
    status: 'active'
  };
}

const kitchen: LiveRoom = {
  roomId: 'kitchen',
  name: 'Кухня',
  isStatic: true,
  avatarUrl: null,
  owner: null,
  since: null,
  peers: []
};

function signedInAs(role: StaffRole, openReports = 0, more: Record<string, Route> = {}) {
  return stubApi({
    'GET /api/staff/me': { body: { ok: true, ...staffOf(role) } },
    'GET /api/admin/user-reports': { body: { ok: true, reports: [] } },
    'GET /api/admin/reports': {
      body: { ok: true, reports: Array.from({ length: openReports }, (_, index) => report(`r-${String(index)}`)) }
    },
    ...more
  });
}

async function menu(): Promise<HTMLElement> {
  return screen.findByRole('navigation', { name: 'Разделы' });
}

async function sections(): Promise<string[]> {
  return within(await menu())
    .getAllByRole('link')
    .map((link) => link.getAttribute('title') ?? '');
}

test('a moderator sees accounts, rooms and reports, and no numbers or staff', async () => {
  signedInAs('moderator');
  render(<App />);
  expect(await sections()).toEqual(['Аккаунты', 'Комнаты', 'Жалобы']);
  // A group with nothing the role may open is not shown at all.
  expect(within(await menu()).queryByText('Аналитика')).toBeNull();
  // "/" is the overview, which a moderator may not open: the first allowed section opens instead.
  await waitFor(() => expect(window.location.pathname).toBe('/accounts'));
  expect(screen.getByText('Модератор')).toBeTruthy();
});

test('a superadmin sees every section in the menu order, the staff one included', async () => {
  signedInAs('superadmin');
  render(<App />);
  expect(await sections()).toEqual([
    'Обзор',
    'Продукт',
    'Отзывы',
    'Сервер',
    'Аккаунты',
    'Комнаты',
    'Жалобы',
    'Сотрудники'
  ]);
  for (const group of ['Аналитика', 'Модерация', 'Команда']) {
    expect(within(await menu()).getByText(group)).toBeTruthy();
  }
});

test('the address keeps the section across a reload, and the top bar names it', async () => {
  window.history.replaceState(null, '', '/staff');
  signedInAs('superadmin');
  render(<App />);
  const staffLink = within(await menu()).getByRole('link', { name: 'Сотрудники' });
  expect(staffLink.getAttribute('aria-current')).toBe('page');
  expect(staffLink.getAttribute('href')).toBe('/staff');
  expect(screen.getByRole('heading', { level: 1, name: 'Сотрудники' })).toBeTruthy();
  expect(window.location.pathname).toBe('/staff');
});

test('a menu item opens its section', async () => {
  window.history.replaceState(null, '', '/accounts');
  signedInAs('moderator');
  render(<App />);
  await userEvent.click(within(await menu()).getByRole('link', { name: 'Жалобы' }));
  expect(window.location.pathname).toBe('/reports');
  expect(screen.getByRole('heading', { level: 1, name: 'Жалобы' })).toBeTruthy();
});

test('the reports item counts the open reports', async () => {
  signedInAs('moderator', 3);
  render(<App />);
  expect(await screen.findByLabelText('открытых: 3')).toBeTruthy();
});

test('the reports item discovers user reports even before opening the review page', async () => {
  signedInAs('moderator', 1, {
    'GET /api/admin/user-reports': {
      body: {
        ok: true,
        reports: [
          {
            id: 'user-r1',
            reason: 'abuse',
            comment: '',
            createdAt: 1,
            reporter: { userId: 'alice', login: 'alice', displayName: 'Alice' },
            target: { userId: 'bob', login: 'bob', displayName: 'Bob', deleted: false }
          }
        ]
      }
    }
  });
  render(<App />);
  expect(await screen.findByLabelText('открытых: 2')).toBeTruthy();
});

test('the reports item keeps the fresh poll count while the reports page stays open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.replaceState(null, '', '/reports');
  let asked = 0;
  stubApi({
    'GET /api/staff/me': { body: { ok: true, ...staffOf('moderator') } },
    'GET /api/admin/user-reports': { body: { ok: true, reports: [] } },
    // The poll and the page ask once each on opening; the poll a minute later hears of two more.
    'GET /api/admin/reports': () => {
      asked += 1;
      const count = asked <= 2 ? 1 : 3;
      return {
        body: { ok: true, reports: Array.from({ length: count }, (_, index) => report(`r-${String(index)}`)) }
      };
    }
  });
  render(<App />);
  expect(await screen.findByLabelText('открытых: 1')).toBeTruthy();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(await screen.findByLabelText('открытых: 3')).toBeTruthy();
  // The page has no new list, so it does not speak again over the fresh count.
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.getByLabelText('открытых: 3')).toBeTruthy();
});

test('the menu folds and stays folded after a reload', async () => {
  signedInAs('moderator');
  const first = render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Свернуть меню' }));
  expect(screen.getByRole('button', { name: 'Закрепить меню открытым' })).toBeTruthy();
  first.unmount();

  const second = render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Закрепить меню открытым' }));
  second.unmount();
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Свернуть меню' })).toBeTruthy();
});

test('a narrow window starts with the menu folded', async () => {
  const width = window.innerWidth;
  window.innerWidth = 800;
  try {
    signedInAs('moderator');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Закрепить меню открытым' })).toBeTruthy();
  } finally {
    window.innerWidth = width;
  }
});

test("an account's card puts the account's name in the top bar under the accounts", async () => {
  window.history.replaceState(null, '', '/accounts/u-alice');
  const detail: AccountDetail = {
    ok: true,
    account: alice(),
    block: null,
    deletion: null,
    days: [],
    ownedRooms: [],
    memberOf: 0,
    devices: [],
    reports: { against: 0, againstOpen: 0, filed: 0 },
    actions: []
  };
  signedInAs('moderator', 0, { 'GET /api/admin/accounts/u-alice': { body: detail } });
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Алиса' })).toBeTruthy();
  const top = document.querySelector<HTMLElement>('header.top');
  expect(top && within(top).getByText('Аккаунты')).toBeTruthy();
});

test('the top bar says how fresh the rooms are and asks again on a click', async () => {
  window.history.replaceState(null, '', '/rooms');
  let asked = 0;
  signedInAs('moderator', 0, {
    'GET /api/admin/rooms': () => {
      asked += 1;
      return { body: { ok: true, rooms: [] } };
    },
    'GET /api/admin/rooms/calls': { body: { ok: true, calls: [], next: null, keepDays: 90 } }
  });
  render(<App />);
  expect(await screen.findByText(/Обновлено/)).toBeTruthy();
  expect(screen.getByText('· каждые 5 с')).toBeTruthy();
  const before = asked;
  await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await waitFor(() => expect(asked).toBe(before + 1));
});

test('a section that does not refresh by itself shows no refresh status', async () => {
  window.history.replaceState(null, '', '/staff');
  signedInAs('superadmin');
  render(<App />);
  await menu();
  expect(screen.queryByRole('button', { name: 'Обновить' })).toBeNull();
});

test('the search finds accounts and rooms in voice, and Enter opens the first', async () => {
  window.history.replaceState(null, '', '/rooms');
  const calls = signedInAs('moderator', 0, {
    'GET /api/admin/accounts': {
      body: { ok: true, accounts: [alice()], total: 1, page: 1, pageSize: 50 }
    },
    'GET /api/admin/accounts/u-alice': { status: 404, body: { ok: false, error: 'нет', code: 'not_found' } },
    'GET /api/admin/rooms': { body: { ok: true, rooms: [kitchen] } },
    'GET /api/admin/rooms/calls': { body: { ok: true, calls: [], next: null, keepDays: 90 } }
  });
  render(<App />);
  const search = await screen.findByRole('combobox', { name: 'Поиск по аккаунтам и комнатам' });

  await userEvent.type(search, 'кух');
  const found = await screen.findByRole('listbox', { name: 'Найдено' });
  expect(within(found).getByRole('option', { name: /Кухня/ })).toBeTruthy();
  expect(
    calls.some((call) => call.url.pathname === '/api/admin/accounts' && call.url.searchParams.get('q') === 'кух')
  ).toBe(true);

  await userEvent.clear(search);
  await userEvent.type(search, 'ali');
  await waitFor(() =>
    expect(within(screen.getByRole('listbox', { name: 'Найдено' })).getByRole('option', { name: /Алиса/ })).toBeTruthy()
  );
  await userEvent.keyboard('{Enter}');
  expect(window.location.pathname).toBe('/accounts/u-alice');
});

test('a room found by the search opens the rooms section with its call history', async () => {
  window.history.replaceState(null, '', '/accounts');
  const calls = signedInAs('moderator', 0, {
    'GET /api/admin/accounts': { body: { ok: true, accounts: [], total: 0, page: 1, pageSize: 50 } },
    'GET /api/admin/rooms': { body: { ok: true, rooms: [kitchen] } },
    'GET /api/admin/rooms/calls': { body: { ok: true, calls: [], next: null, keepDays: 90 } }
  });
  render(<App />);
  await userEvent.type(await screen.findByRole('combobox', { name: 'Поиск по аккаунтам и комнатам' }), 'kitchen');
  await userEvent.click(await screen.findByRole('option', { name: /Кухня/ }));
  expect(window.location.pathname).toBe('/rooms');
  expect(await screen.findByRole('button', { name: /Показать все комнаты/ })).toBeTruthy();
  const asked = calls.filter((call) => call.url.pathname === '/api/admin/rooms/calls');
  expect(asked.at(-1)?.url.searchParams.get('roomId')).toBe('kitchen');
});

test('nothing found is said so', async () => {
  signedInAs('moderator', 0, {
    'GET /api/admin/accounts': { body: { ok: true, accounts: [], total: 0, page: 1, pageSize: 50 } },
    'GET /api/admin/rooms': { body: { ok: true, rooms: [] } }
  });
  render(<App />);
  await userEvent.type(await screen.findByRole('combobox', { name: 'Поиск по аккаунтам и комнатам' }), 'zzz');
  expect(await screen.findByText('Ничего не найдено')).toBeTruthy();
});

test('Ctrl+K puts the cursor in the search', async () => {
  signedInAs('moderator');
  render(<App />);
  const search = await screen.findByRole('combobox', { name: 'Поиск по аккаунтам и комнатам' });
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(document.activeElement).toBe(search);
});
