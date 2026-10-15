// The accounts tab of the admin panel: the list asks the server for what is
// searched, filtered and sorted and opens a card from a row; the card blocks,
// deletes (only once the login is typed again) and marks an account, and
// offers nothing against an administrator's account; the mark shows by the
// name; a card has its own address; a blocked sign-in reads why and until when.

import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AccountDetail, AccountRow, AccountsPage } from '@voice-room/shared/contracts/admin';
import AdminAccounts from '../../src/lib/features/admin/AdminAccounts.svelte';
import AdminAccountCard from '../../src/lib/features/admin/AdminAccountCard.svelte';
import { adminLocationFromPath, adminPath } from '../../src/lib/features/admin/tabs';
import { blockedMessage } from '../../src/lib/features/auth/account';
import { AccountBadge } from '../../src/lib/shared/ui';
import { badgeOf, setAccountBadges } from '../../src/lib/shared/badges.svelte';

const DAY = 24 * 60 * 60 * 1000;

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
  setAccountBadges([]);
});

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'u-alice',
    login: 'alice',
    displayName: 'Алиса',
    avatarUrl: null,
    avatarColorKey: 'blurple',
    avatarAccent: null,
    createdAt: Date.now() - 10 * DAY,
    lastSeenAt: Date.now() - DAY,
    activeDays: 4,
    clients: { desktopApp: true, browser: false, mobile: false },
    voiceMinutes: 150,
    messages: 42,
    ownedRooms: 1,
    reportsAgainst: 2,
    online: false,
    admin: false,
    badge: null,
    status: 'active',
    ...overrides
  };
}

function detail(overrides: Partial<Omit<AccountDetail, 'ok'>> = {}): AccountDetail {
  return {
    ok: true,
    account: row(),
    block: null,
    deletion: null,
    days: [{ day: '2026-10-15', active: true, messages: 3, voiceMinutes: 20 }],
    ownedRooms: [{ id: 'kitchen', name: 'Кухня', members: 3 }],
    memberOf: 2,
    devices: [{ client: 'Chrome', os: 'Windows', createdAt: Date.now() - DAY, lastSeenAt: Date.now() }],
    reports: { against: 2, againstOpen: 1, filed: 0 },
    actions: [],
    ...overrides
  };
}

type Reply = { status?: number; body: unknown };
type Call = { method: string; url: URL; body: unknown };

/** Answers by "METHOD /path"; the query string is recorded, not matched. */
function stubApi(routes: Record<string, Reply | ((call: Call) => Reply)>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const call = { method, url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null };
      calls.push(call);
      const route = routes[`${method} ${url.pathname}`];
      const reply = typeof route === 'function' ? route(call) : (route ?? { status: 500, body: { ok: false } });
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' }
      });
    })
  );
  return calls;
}

const page = (accounts: AccountRow[]): Reply => ({
  body: { ok: true, accounts, total: accounts.length, page: 1, pageSize: 50 } satisfies AccountsPage
});

test('the list asks for what is searched, filtered and sorted, and a row opens the card', async () => {
  const calls = stubApi({
    'GET /api/admin/accounts': page([
      row(),
      row({ id: 'u-bob', login: 'bob', displayName: '', status: 'blocked', admin: false, reportsAgainst: 0 })
    ])
  });
  const onOpenAccount = vi.fn();
  render(AdminAccounts, { props: { onOpenAccount } });

  const alice = await screen.findByRole('button', { name: /Алиса/ });
  expect(screen.getByText('@alice')).toBeTruthy();
  expect(screen.getByText('заблокирован')).toBeTruthy();
  expect(screen.getAllByText('2,5 ч')).toHaveLength(2);
  expect(calls[0]?.url.searchParams.get('sort')).toBe('created');
  expect(calls[0]?.url.searchParams.get('order')).toBe('desc');

  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск аккаунта' }), 'ali');
  await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('q')).toBe('ali'));

  await userEvent.click(screen.getByRole('button', { name: 'Сообщений' }));
  await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('sort')).toBe('messages'));
  expect(calls.at(-1)?.url.searchParams.get('order')).toBe('desc');
  await userEvent.click(screen.getByRole('button', { name: 'Сообщений, по убыванию' }));
  await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('order')).toBe('asc'));

  await userEvent.click(alice);
  expect(onOpenAccount).toHaveBeenCalledWith('u-alice');
});

test('the card blocks with a term and a reason, then offers to lift it', async () => {
  const blocked = detail({
    account: row({ status: 'blocked' }),
    block: { at: Date.now(), until: null, reason: 'Спам' },
    actions: [
      { id: 'a1', at: Date.now(), action: 'block', reason: 'Спам', adminName: 'Root', until: null, badge: null }
    ]
  });
  const calls = stubApi({
    'GET /api/admin/accounts/u-alice': { body: detail() },
    'POST /api/admin/accounts/u-alice/block': { body: blocked }
  });
  render(AdminAccountCard, { props: { userId: 'u-alice', onBack: vi.fn() } });

  await screen.findByRole('heading', { name: /Алиса/ });
  expect(screen.getByText('Кухня')).toBeTruthy();
  expect(screen.getByText('Chrome · Windows')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Заблокировать…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Заблокировать Алиса' });
  const submit = within(dialog).getByRole('button', { name: 'Заблокировать' });
  expect(submit).toHaveProperty('disabled', true);
  await userEvent.click(within(dialog).getByRole('radio', { name: 'Навсегда' }));
  await userEvent.type(within(dialog).getByLabelText('Причина'), '  Спам ');
  await userEvent.click(submit);

  await screen.findByRole('button', { name: 'Разблокировать' });
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ duration: 'forever', reason: 'Спам' });
  expect(screen.getByText(/Заблокирован навсегда\. Причина: Спам/)).toBeTruthy();
  expect(screen.getByText('Блокировка навсегда')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Заблокировать…' })).toBeNull();
});

test('deleting asks for the login again and a reason', async () => {
  const calls = stubApi({
    'GET /api/admin/accounts/u-alice': { body: detail() },
    'POST /api/admin/accounts/u-alice/delete': {
      body: detail({
        account: row({ status: 'deleting' }),
        deletion: { scheduledFor: Date.now() + 7 * DAY, byAdmin: true },
        block: { at: Date.now(), until: null, reason: 'Бот' }
      })
    }
  });
  render(AdminAccountCard, { props: { userId: 'u-alice', onBack: vi.fn() } });
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить аккаунт…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Удалить аккаунт' });
  const submit = within(dialog).getByRole('button', { name: 'Удалить аккаунт' });
  await userEvent.type(within(dialog).getByLabelText('Причина'), 'Бот');
  await userEvent.type(within(dialog).getByLabelText(/Введите логин/), 'alic');
  expect(submit).toHaveProperty('disabled', true);
  await userEvent.type(within(dialog).getByLabelText(/Введите логин/), 'e');
  expect(submit).toHaveProperty('disabled', false);
  await userEvent.click(submit);

  await screen.findByRole('button', { name: 'Отменить удаление' });
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ login: 'alice', reason: 'Бот' });
  expect(screen.getByText(/по решению администратора/)).toBeTruthy();
});

test('an administrator account offers no sanctions, but may be marked official', async () => {
  const calls = stubApi({
    'GET /api/admin/accounts/u-root': { body: detail({ account: row({ id: 'u-root', login: 'root', admin: true }) }) },
    'POST /api/admin/accounts/u-root/badge': {
      body: detail({ account: row({ id: 'u-root', login: 'root', admin: true, badge: 'official' }) })
    },
    'GET /api/badges': { body: { ok: true, badges: [{ userId: 'u-root', badge: 'official' }] } }
  });
  render(AdminAccountCard, { props: { userId: 'u-root', onBack: vi.fn() } });
  await screen.findByText(/аккаунт администратора/);
  expect(screen.queryByRole('button', { name: 'Заблокировать…' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Удалить аккаунт…' })).toBeNull();

  await userEvent.click(screen.getByRole('switch', { name: 'Официальный аккаунт' }));
  await waitFor(() => expect(badgeOf('u-root')).toBe('official'));
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ badge: 'official' });
  expect(screen.getByRole('img', { name: 'Официальный аккаунт VoiceRoom' })).toBeTruthy();
});

test('the mark shows only by a marked account', () => {
  setAccountBadges([{ userId: 'u-official', badge: 'official' }]);
  const { container } = render(AccountBadge, { props: { userId: 'u-someone' } });
  expect(container.querySelector('.account-badge')).toBeNull();
  cleanup();
  render(AccountBadge, { props: { userId: 'u-official' } });
  expect(screen.getByRole('img', { name: 'Официальный аккаунт VoiceRoom' })).toBeTruthy();
  expect(badgeOf(null)).toBeNull();
});

test('an account card has its own address under the accounts tab', () => {
  expect(adminLocationFromPath('/admin/accounts')).toEqual({ tab: 'accounts', accountId: null });
  expect(adminLocationFromPath('/admin/accounts/u-1')).toEqual({ tab: 'accounts', accountId: 'u-1' });
  expect(adminLocationFromPath('/admin/accounts/u-1/')).toEqual({ tab: 'accounts', accountId: 'u-1' });
  expect(adminLocationFromPath('/admin/system/u-1')).toBeNull();
  expect(adminPath('accounts', 'u 1')).toBe('/admin/accounts/u%201');
  expect(adminPath('accounts')).toBe('/admin/accounts');
  expect(adminPath('system', 'u-1')).toBe('/admin/system');
});

test('a blocked sign-in reads until when and why', () => {
  expect(blockedMessage({ blockedUntil: null, blockReason: 'Спам' })).toBe(
    'Аккаунт заблокирован навсегда. Причина: Спам'
  );
  expect(blockedMessage({ blockedUntil: Date.UTC(2026, 9, 22, 12), blockReason: '' })).toMatch(
    /^Аккаунт заблокирован до 22 октября 2026 г\.,? (в )?\d{2}:00\.$/
  );
});
