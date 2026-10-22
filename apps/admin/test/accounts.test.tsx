// The accounts section of the admin app: the list asks the server for what is
// searched, filtered and sorted and opens a card from a row; the card blocks,
// deletes (only once the login is typed again) and marks an account, and
// offers nothing against a staff member's account; the mark shows by the name;
// a card has its own address; and each role is offered only what it may do.

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AccountDetail, AccountRow, AccountsPage } from '@voice-room/shared/contracts/admin';
import { forgetBadges } from '../src/badges.ts';
import { AccountsPage as AccountsSection } from '../src/pages/AccountsPage.tsx';
import { locationFromPath, pathOf } from '../src/tabs.ts';
import { AccountBadge } from '../src/ui/index.tsx';
import { describeAction } from '../src/accounts.ts';
import { stubChartBox } from './helpers/chart-box.ts';
import { renderAs, stubApi, type Call, type Reply } from './helpers/harness.tsx';

const DAY = 24 * 60 * 60 * 1000;

let restoreChartBox = () => {};
beforeEach(() => {
  forgetBadges();
  restoreChartBox = stubChartBox();
});

afterEach(() => {
  cleanup();
  restoreChartBox();
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

const page = (accounts: AccountRow[]): Reply => ({
  body: { ok: true, accounts, total: accounts.length, page: 1, pageSize: 50 } satisfies AccountsPage
});

const lastParam = (calls: Call[], name: string) => calls.at(-1)?.url.searchParams.get(name);

test('the list asks for what is searched, filtered and sorted, and a row opens the card', async () => {
  const calls = stubApi({
    'GET /api/admin/accounts': page([
      row(),
      row({ id: 'u-bob', login: 'bob', displayName: '', status: 'blocked', admin: false, reportsAgainst: 0 })
    ])
  });
  const onOpenAccount = vi.fn();
  renderAs(<AccountsSection accountId={null} onOpenAccount={onOpenAccount} />);

  const alice = await screen.findByRole('button', { name: /Алиса/ });
  expect(screen.getByText('@alice')).toBeTruthy();
  expect(screen.getByText('заблокирован')).toBeTruthy();
  expect(screen.getAllByText('2,5 ч')).toHaveLength(2);
  expect(calls[0]?.url.searchParams.get('sort')).toBe('created');
  expect(calls[0]?.url.searchParams.get('order')).toBe('desc');

  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск аккаунта' }), 'ali');
  await waitFor(() => expect(lastParam(calls, 'q')).toBe('ali'));

  await userEvent.click(
    within(screen.getByRole('radiogroup', { name: 'Показать' })).getByRole('radio', { name: 'Заблокированные' })
  );
  await waitFor(() => expect(lastParam(calls, 'filter')).toBe('blocked'));

  await userEvent.click(screen.getByRole('button', { name: 'Сообщений' }));
  await waitFor(() => expect(lastParam(calls, 'sort')).toBe('messages'));
  expect(lastParam(calls, 'order')).toBe('desc');
  await userEvent.click(screen.getByRole('button', { name: 'Сообщений, по убыванию' }));
  await waitFor(() => expect(lastParam(calls, 'order')).toBe('asc'));

  await userEvent.click(alice);
  expect(onOpenAccount).toHaveBeenCalledWith('u-alice');
});

test('a staff member is called a сотрудник in the list', async () => {
  stubApi({ 'GET /api/admin/accounts': page([row({ admin: true })]) });
  renderAs(<AccountsSection accountId={null} onOpenAccount={vi.fn()} />);
  expect(await screen.findByText('сотрудник')).toBeTruthy();
});

test('the card blocks with a term and a reason, then offers to lift it', async () => {
  const blocked = detail({
    account: row({ status: 'blocked' }),
    block: { at: Date.now(), until: null, reason: 'Спам' },
    actions: [
      {
        id: 'a1',
        at: Date.now(),
        action: 'block',
        reason: 'Спам',
        adminName: 'Root',
        until: null,
        badge: null,
        role: null
      }
    ]
  });
  const calls = stubApi({
    'GET /api/admin/accounts/u-alice': { body: detail() },
    'POST /api/admin/accounts/u-alice/block': { body: blocked }
  });
  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />);

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
  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />);
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

test('a staff account offers no sanctions, but may be marked official', async () => {
  const marked = detail({ account: row({ id: 'u-root', login: 'root', admin: true, badge: 'official' }) });
  const calls = stubApi({
    'GET /api/admin/accounts/u-root': { body: detail({ account: row({ id: 'u-root', login: 'root', admin: true }) }) },
    'POST /api/admin/accounts/u-root/badge': { body: marked },
    // The mark is on the server's list only once it was set.
    'GET /api/badges': () => ({
      body: {
        ok: true,
        badges: calls.some((call) => call.method === 'POST') ? [{ userId: 'u-root', badge: 'official' }] : []
      }
    })
  });
  renderAs(<AccountsSection accountId="u-root" onOpenAccount={vi.fn()} />);
  await screen.findByText(/аккаунт сотрудника/);
  expect(screen.queryByRole('button', { name: 'Заблокировать…' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Удалить аккаунт…' })).toBeNull();
  expect(screen.queryByTitle('Официальный аккаунт')).toBeNull();

  await userEvent.click(screen.getByRole('switch', { name: 'Официальный аккаунт' }));
  await screen.findByTitle('Официальный аккаунт');
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ badge: 'official' });
});

test('the mark shows only by a marked account', async () => {
  stubApi({
    'GET /api/badges': { body: { ok: true, badges: [{ userId: 'u-official', badge: 'official' }] } }
  });
  const { container } = renderAs(<AccountBadge userId="u-someone" />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(container.querySelector('.ui-account-badge')).toBeNull();
  cleanup();
  renderAs(<AccountBadge userId="u-official" />);
  await screen.findByTitle('Официальный аккаунт');
});

test('an account card has its own address under the accounts section', () => {
  expect(locationFromPath('/accounts')).toEqual({ tab: 'accounts', accountId: null });
  expect(locationFromPath('/accounts/u-1')).toEqual({ tab: 'accounts', accountId: 'u-1' });
  expect(locationFromPath('/accounts/u-1/')).toEqual({ tab: 'accounts', accountId: 'u-1' });
  expect(locationFromPath('/system/u-1')).toEqual({ tab: 'overview', accountId: null });
  expect(pathOf({ tab: 'accounts', accountId: 'u 1' })).toBe('/accounts/u%201');
  expect(pathOf({ tab: 'accounts', accountId: null })).toBe('/accounts');
  expect(pathOf({ tab: 'system', accountId: 'u-1' })).toBe('/system');
});

test('the log words a role given and taken away', () => {
  const entry = { id: 'a', at: 0, reason: '', adminName: 'Root', until: null, badge: null };
  expect(describeAction({ ...entry, action: 'staff_role', role: 'moderator' })).toBe('Выдана роль: Модератор');
  expect(describeAction({ ...entry, action: 'staff_role', role: null })).toBe('Роль снята');
});

test('a moderator is offered a timed block and sign-out; an admin also delete, the mark and a block for good', async () => {
  stubApi({ 'GET /api/admin/accounts/u-alice': { body: detail() } });

  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />, 'moderator');
  await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать…' }));
  const timed = await screen.findByRole('dialog', { name: 'Заблокировать Алиса' });
  expect(within(timed).getByRole('radio', { name: 'Неделя' })).toBeTruthy();
  expect(within(timed).queryByRole('radio', { name: 'Навсегда' })).toBeNull();
  await userEvent.click(within(timed).getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('button', { name: 'Разлогинить везде' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Удалить аккаунт…' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Официальный аккаунт' })).toBeNull();
  cleanup();

  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />, 'admin');
  await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать…' }));
  const forever = await screen.findByRole('dialog', { name: 'Заблокировать Алиса' });
  expect(within(forever).getByRole('radio', { name: 'Навсегда' })).toBeTruthy();
  await userEvent.click(within(forever).getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('button', { name: 'Удалить аккаунт…' })).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Официальный аккаунт' })).toBeTruthy();
});

test('a moderator lifts a block with an end but not one without', async () => {
  const blockedFor = (until: number | null) =>
    detail({ account: row({ status: 'blocked' }), block: { at: Date.now(), until, reason: 'Спам' } });

  stubApi({ 'GET /api/admin/accounts/u-alice': { body: blockedFor(Date.now() + DAY) } });
  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />, 'moderator');
  expect(await screen.findByRole('button', { name: 'Разблокировать' })).toBeTruthy();
  cleanup();

  stubApi({ 'GET /api/admin/accounts/u-alice': { body: blockedFor(null) } });
  renderAs(<AccountsSection accountId="u-alice" onOpenAccount={vi.fn()} />, 'moderator');
  await screen.findByText(/Заблокирован навсегда/);
  expect(screen.queryByRole('button', { name: 'Разблокировать' })).toBeNull();
});

test('a mark list that failed to load is asked for again by the next look', async () => {
  let failing = true;
  stubApi({
    'GET /api/badges': () =>
      failing
        ? { status: 500, body: { ok: false, error: 'boom', code: 'internal_error' } }
        : { body: { ok: true, badges: [{ userId: 'u-official', badge: 'official' }] } }
  });
  renderAs(<AccountBadge userId="u-official" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByTitle('Официальный аккаунт')).toBeNull();
  cleanup();

  failing = false;
  renderAs(<AccountBadge userId="u-official" />);
  await screen.findByTitle('Официальный аккаунт');
});
