// Deleting the account asks for the password and says what the grace period
// keeps; a new sign-in asks "was it you?" and "no" leads to securing the account.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import DeleteAccountDialog from '../../src/lib/features/home/components/DeleteAccountDialog.svelte';
import LoginAlertDialog from '../../src/lib/features/home/components/LoginAlertDialog.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';

afterEach(cleanup);

const ALERT_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

test('deletion waits for the password and the acknowledgement, and names what happens to rooms', async () => {
  const { calls } = stubFetch({
    'GET /api/auth/account/deletion': {
      body: {
        ok: true,
        graceDays: 7,
        rooms: [
          { roomId: 'r1', name: 'Кухня', heir: { displayName: 'Боб', login: 'bob' } },
          { roomId: 'r2', name: 'Пустая', heir: null }
        ]
      }
    },
    'POST /api/auth/account/deletion': { body: { ok: true, deletionScheduledFor: Date.UTC(2026, 9, 6) } }
  });
  const onToast = vi.fn();
  render(DeleteAccountDialog, { props: { open: true, onClose: vi.fn(), onToast } });

  expect(await screen.findByText(/перейдёт к Боб/)).toBeTruthy();
  expect(screen.getByText('удалится: других участников нет')).toBeTruthy();
  const submit = screen.getByRole('button', { name: 'Удалить аккаунт' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);

  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'secret-pass');
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(submit);

  await vi.waitFor(() =>
    expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/Передумали — просто войдите снова/))
  );
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ currentPassword: 'secret-pass' });
});

test('a wrong password keeps the dialog open with the reason', async () => {
  stubFetch({
    'GET /api/auth/account/deletion': { body: { ok: true, graceDays: 7, rooms: [] } },
    'POST /api/auth/account/deletion': {
      status: 403,
      body: { ok: false, error: 'Invalid password', code: 'invalid_credentials' }
    }
  });
  const onToast = vi.fn();
  render(DeleteAccountDialog, { props: { open: true, onClose: vi.fn(), onToast } });
  await userEvent.type(await screen.findByLabelText('Текущий пароль'), 'wrong');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));

  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(onToast).not.toHaveBeenCalled();
});

function stubAlerts(deny: Record<string, unknown>) {
  installFakeWebSocket();
  return stubFetch({
    'GET /api/auth/login-alerts': {
      body: {
        ok: true,
        alerts: [{ id: ALERT_ID, kind: 'login', client: 'Firefox', os: 'Linux', location: 'Берлин', createdAt: 1 }]
      }
    },
    [`POST /api/auth/login-alerts/${ALERT_ID}/deny`]: { body: deny },
    [`POST /api/auth/login-alerts/${ALERT_ID}/confirm`]: { body: { ok: true, resolution: 'confirmed' } }
  });
}

test('"it was not me" ends that session and leads to changing the password', async () => {
  stubAlerts({
    ok: true,
    resolution: 'denied',
    sessionEnded: true,
    recoveryCodes: { remaining: 0, generatedAt: null }
  });
  const onSecureAccount = vi.fn();
  const onOpenChange = vi.fn();
  render(LoginAlertDialog, { props: { onSecureAccount, onOpenChange, onToast: vi.fn() } });

  await userEvent.click(await screen.findByRole('button', { name: 'Это не я' }));
  expect(await screen.findByText(/Сеанс на том устройстве завершён/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Создать коды восстановления' })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }));
  expect(onSecureAccount).toHaveBeenCalledWith('password');
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
});

test('"it was me" closes the question; closing without an answer only postpones it', async () => {
  const { calls } = stubAlerts({});
  const onOpenChange = vi.fn();
  const view = render(LoginAlertDialog, { props: { onSecureAccount: vi.fn(), onOpenChange, onToast: vi.fn() } });

  await screen.findByRole('button', { name: 'Это я' });
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Это я' })).toBeNull());
  expect(calls.some((call) => call.url.endsWith('/confirm') || call.url.endsWith('/deny'))).toBe(false);

  view.unmount();
  render(LoginAlertDialog, { props: { onSecureAccount: vi.fn(), onOpenChange, onToast: vi.fn() } });
  await userEvent.click(await screen.findByRole('button', { name: 'Это я' }));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Это я' })).toBeNull());
  expect(calls.some((call) => call.url.endsWith('/confirm'))).toBe(true);
});
