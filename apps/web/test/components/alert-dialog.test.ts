import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { AlertDialog } from '@voiceroom/ui-kit/components';
import { expect, test, vi } from 'vitest';

function renderConfirmation(busy = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(AlertDialog, {
    props: {
      open: true,
      title: 'Удалить комнату «Пятничные игры»?',
      description: 'Комната будет удалена для всех участников.',
      confirmLabel: 'Удалить',
      tone: 'danger',
      busy,
      onConfirm,
      onCancel
    }
  });
  return { onConfirm, onCancel };
}

test('Cancel receives focus and emits cancel', async () => {
  const { onCancel } = renderConfirmation();
  const cancel = await screen.findByRole('button', { name: 'Отмена' });
  await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
  await userEvent.click(cancel);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('the backdrop keeps the confirmation open, Escape emits cancel', async () => {
  const { onCancel } = renderConfirmation();
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Удалить комнату «Пятничные игры»?',
    description: 'Комната будет удалена для всех участников.'
  });
  const overlay = dialog.parentElement;
  if (!overlay) throw new Error('dialog has no overlay');
  await userEvent.setup({ pointerEventsCheck: 0 }).click(overlay);
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog')).toBe(dialog);
  expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();

  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('confirm emits confirm', async () => {
  const { onConfirm, onCancel } = renderConfirmation();
  await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test('busy disables the action and exposes its pending state', async () => {
  const { onConfirm } = renderConfirmation(true);
  const confirm = await screen.findByRole('button', { name: 'Удалить' });
  expect(confirm).toHaveProperty('disabled', true);
  expect(confirm.getAttribute('aria-busy')).toBe('true');
  await userEvent.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
});
