// Signing in with a one-time recovery code, and restoring an account that is
// waiting to be deleted instead of failing the sign-in.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import AuthDialog from '@/features/auth/AuthDialog.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { stubFetch } from '../fixtures/fetch';
import { authUser } from '../fixtures/users';
import { renderWithApp } from '../helpers/render';

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
});

async function renderDialog(mode: 'login' | 'recover') {
  const onAuthenticated = vi.fn();
  await renderWithApp(AuthDialog, { props: { mode, onAuthenticated } });
  useSessionStore().loaded = true;
  return onAuthenticated;
}

test('a recovery code signs in with a new password; a malformed code is refused first', async () => {
  const user = authUser({ login: 'ada' });
  const { calls } = stubFetch({
    'POST /api/auth/recover': { body: { ok: true, user, recoveryCodes: { remaining: 9 } } }
  });
  const onAuthenticated = await renderDialog('recover');

  await userEvent.type(screen.getByLabelText('Логин'), 'ada');
  await userEvent.type(screen.getByLabelText('Код восстановления'), 'short');
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'new-password-1');
  await userEvent.type(screen.getByLabelText('Повторите пароль'), 'new-password-1');
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль и войти' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/16 символов/);
  expect(calls).toEqual([]);

  const code = screen.getByLabelText('Код восстановления');
  await userEvent.clear(code);
  await userEvent.type(code, 'abcd-efgh-jkmn-pqrs');
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль и войти' }));

  await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
  expect(calls[0]).toMatchObject({
    method: 'POST',
    url: '/api/auth/recover',
    body: { login: 'ada', code: 'abcd-efgh-jkmn-pqrs', newPassword: 'new-password-1' }
  });
});

test('signing in to an account waiting for deletion offers to restore it', async () => {
  const user = authUser({ login: 'ada' });
  stubFetch({
    'POST /api/auth/login': {
      status: 409,
      body: {
        ok: false,
        error: 'Account deletion pending',
        code: 'account_deletion_pending',
        deletionScheduledFor: Date.UTC(2026, 9, 6)
      }
    },
    'POST /api/auth/account/restore': { body: { ok: true, user } }
  });
  const onAuthenticated = await renderDialog('login');

  await userEvent.type(screen.getByLabelText('Логин'), 'ada');
  await userEvent.type(screen.getByLabelText('Пароль'), 'old-password');
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }));

  expect((await screen.findByRole('status')).textContent).toMatch(/ожидает удаления/);
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Восстановить аккаунт' }));
  await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
});
