// The security tab lists where the account is open and ends those sessions,
// and changes the password, which ends every session including this one.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import AccountSecuritySettings from '../../src/lib/features/home/components/AccountSecuritySettings.svelte';
import { session } from '../../src/lib/features/auth/session.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';

afterEach(cleanup);

const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LAPTOP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function stubSecurity(extra = {}) {
  return stubFetch({
    'GET /api/auth/security': {
      body: {
        ok: true,
        recoveryCodes: { remaining: 10, generatedAt: 1 },
        recoveryCodesReminder: { snoozedUntil: null }
      }
    },
    'GET /api/auth/sessions': {
      body: {
        ok: true,
        sessions: [
          { id: HERE, current: true, client: 'Firefox', os: 'Windows', location: '', lastSeenAt: 1 },
          { id: PHONE, current: false, client: 'Chrome', os: 'Android', location: 'Берлин', lastSeenAt: 1 },
          { id: LAPTOP, current: false, client: 'Safari', os: 'macOS', location: '', lastSeenAt: 1 }
        ]
      }
    },
    ...extra
  });
}

function renderTab() {
  const onToast = vi.fn();
  render(AccountSecuritySettings, { props: { login: 'ada', onToast } });
  return onToast;
}

test('other sessions can be ended one by one or all at once; this device cannot', async () => {
  const { calls } = stubSecurity({
    [`DELETE /api/auth/sessions/${PHONE}`]: { body: { ok: true } },
    'POST /api/auth/sessions/revoke-others': { body: { ok: true, revoked: 1 } }
  });
  const onToast = renderTab();

  const here = (await screen.findByText('Это устройство')).closest('.account-security-row') as HTMLElement;
  expect(within(here).queryByRole('button', { name: 'Завершить' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Завершить' })).toHaveLength(2);

  await userEvent.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Сеанс завершён'));
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith(PHONE))).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Завершить' })).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Выйти на других устройствах' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Завершено сеансов: 1'));
  expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Выйти на других устройствах' })).toBeNull();
});

test('a password change ends this session too and signs out', async () => {
  session.user = authUser();
  const { calls } = stubSecurity({ 'POST /api/auth/password': { body: { ok: true } } });
  const onToast = renderTab();

  const change = await screen.findByRole('button', { name: 'Сменить пароль' });
  expect((change as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'old-password');
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'new-password-1');
  await userEvent.click(change);

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Пароль изменён, войдите снова'));
  expect(calls.find((call) => call.url === '/api/auth/password')?.body).toEqual({
    currentPassword: 'old-password',
    newPassword: 'new-password-1'
  });
  expect(session.user).toBeNull();
});

test('a too short new password is refused before anything is sent', async () => {
  const { calls } = stubSecurity();
  const onToast = renderTab();
  await userEvent.type(await screen.findByLabelText('Текущий пароль'), 'old-password');
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'short');
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }));

  expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/^Новый пароль: минимум/));
  expect(calls.some((call) => call.url === '/api/auth/password')).toBe(false);
});
