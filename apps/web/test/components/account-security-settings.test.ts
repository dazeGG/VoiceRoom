// The security tab lists where the account is open and ends those sessions,
// and changes the password, which ends every session including this one.

import { screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import AccountSecuritySettings from '@/features/home/components/AccountSecuritySettings.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { instanceOf, defined } from '../helpers/assert.ts';
import { renderWithApp } from '../helpers/render.ts';

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

async function renderTab() {
  const onToast = vi.fn();
  const view = await renderWithApp(AccountSecuritySettings, { props: { login: 'ada', onToast } });
  return { onToast, pinia: view.pinia };
}

test('other sessions can be ended one by one or all at once; this device cannot', async () => {
  const { calls } = stubSecurity({
    [`DELETE /api/auth/sessions/${PHONE}`]: { body: { ok: true } },
    'POST /api/auth/sessions/revoke-others': { body: { ok: true, revoked: 1 } }
  });
  const { onToast } = await renderTab();

  const here = instanceOf(
    (await screen.findByText('Это устройство')).closest('.account-security__row'),
    HTMLElement,
    'this device row'
  );
  expect(within(here).queryByRole('button', { name: 'Завершить' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Завершить' })).toHaveLength(2);

  await userEvent.click(
    defined(
      screen.getAllByRole('button', { name: 'Завершить' })[0],
      "screen.getAllByRole('button', { name: 'Завершить' })[0]"
    )
  );
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Сеанс завершён'));
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith(PHONE))).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Завершить' })).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Выйти на других устройствах' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Завершено сеансов: 1'));
  expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Выйти на других устройствах' })).toBeNull();
});

test('a password change ends this session too and signs out', async () => {
  const { calls } = stubSecurity({ 'POST /api/auth/password': { body: { ok: true } } });
  const { onToast, pinia } = await renderTab();
  const session = useSessionStore(pinia);
  session.setUser(authUser());

  const change = await screen.findByRole('button', { name: 'Сменить пароль' });
  expect(change).toHaveProperty('disabled', true);
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
  const { onToast } = await renderTab();
  await userEvent.type(await screen.findByLabelText('Текущий пароль'), 'old-password');
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'short');
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }));

  expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/^Новый пароль: минимум/));
  expect(calls.some((call) => call.url === '/api/auth/password')).toBe(false);
});
