import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import RecoveryCodesDialog from '../../src/lib/features/home/components/RecoveryCodesDialog.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(cleanup);

function renderDialog() {
  const props = { open: true, login: 'anya', onClose: vi.fn(), onGenerated: vi.fn(), onToast: vi.fn() };
  render(RecoveryCodesDialog, { props });
  return props;
}

test('codes are created with the current password, shown once, and the dialog closes only after "saved"', async () => {
  const codes = Array.from({ length: 10 }, (_, index) => `CODE-${index}`);
  const { calls } = stubFetch({
    'POST /api/auth/recovery-codes': { body: { codes, recoveryCodes: { remaining: 10, generatedAt: 1 } } }
  });
  const props = renderDialog();

  await userEvent.click(screen.getByRole('button', { name: 'Создать коды' }));
  expect(screen.getByRole('alert').textContent).toBe('Введите текущий пароль');
  expect(calls).toEqual([]);

  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'secret');
  await userEvent.click(screen.getByRole('button', { name: 'Создать коды' }));

  expect(await screen.findByText('CODE-9')).toBeTruthy();
  expect(calls[0]).toMatchObject({ url: '/api/auth/recovery-codes', body: { currentPassword: 'secret' } });
  expect(props.onGenerated).toHaveBeenCalledWith({ remaining: 10, generatedAt: 1 });

  const done = screen.getByRole('button', { name: 'Готово' });
  expect(done).toHaveProperty('disabled', true);
  await userEvent.click(screen.getByLabelText('Я сохранил коды'));
  await userEvent.click(done);
  expect(props.onClose).toHaveBeenCalled();
});

test('a wrong password is reported and no codes appear', async () => {
  stubFetch({ 'POST /api/auth/recovery-codes': { status: 403, body: { ok: false, error: 'Неверный пароль' } } });
  renderDialog();
  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Создать коды' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Неверный пароль');
  expect(screen.queryByText(/CODE-/)).toBeNull();
});
