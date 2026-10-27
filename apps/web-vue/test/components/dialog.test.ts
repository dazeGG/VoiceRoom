import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Dialog as UiDialog } from '@/shared/ui/Dialog';

function hostWith(onClosed: () => void) {
  return defineComponent({
    setup() {
      const open = ref(false);
      function close(): void {
        open.value = false;
        onClosed();
      }
      return () => [
        h('button', { type: 'button', onClick: () => (open.value = true) }, 'Open'),
        h(UiDialog, { open: open.value, title: 'Настройки', onClose: close }, () => [
          h('input', { 'aria-label': 'first' }),
          h('button', { type: 'button' }, 'last')
        ])
      ];
    }
  });
}

async function openDialog() {
  const onClosed = vi.fn();
  render(hostWith(onClosed));
  const opener = screen.getByRole('button', { name: 'Open' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Настройки' });
  return { onClosed, opener, dialog };
}

test('focus starts on the close button and Tab wraps inside the dialog', async () => {
  const { dialog } = await openDialog();
  const close = screen.getByRole('button', { name: 'Закрыть' });
  await vi.waitFor(() => expect(document.activeElement).toBe(close));

  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('first'));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(close);
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
  expect(dialog.contains(document.activeElement)).toBe(true);
});

test('Escape closes and focus returns to the opener', async () => {
  const { onClosed, opener } = await openDialog();
  await userEvent.keyboard('{Escape}');

  expect(onClosed).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

test('a press outside the card closes, a press inside does not', async () => {
  const { onClosed, dialog } = await openDialog();
  await userEvent.click(dialog);
  expect(onClosed).not.toHaveBeenCalled();

  const overlay = dialog.parentElement;
  if (!overlay) throw new Error('dialog has no overlay');
  await userEvent.click(overlay);
  expect(onClosed).toHaveBeenCalledTimes(1);
});
