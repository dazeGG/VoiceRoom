import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Dialog as UiDialog, Toast } from '@voice-room/ui/components';
import type { ToastItem } from '@voice-room/ui/toast';

function hostWith(onClosed: () => void, toasts: ToastItem[] = []) {
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
        ]),
        ...(toasts.length > 0 ? [h(Toast, { toasts, onDismiss: () => {} })] : [])
      ];
    }
  });
}

async function openDialog(toasts: ToastItem[] = []) {
  const onClosed = vi.fn();
  render(hostWith(onClosed, toasts));
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

test('the localized close button closes the dialog', async () => {
  const { onClosed } = await openDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the dialog exposes its description, size and footer with the close button hidden', async () => {
  render(UiDialog, {
    props: {
      open: true,
      title: 'Настройки',
      description: 'Настройки звонка',
      size: 'lg',
      closable: false,
      onClose: vi.fn()
    },
    slots: { footer: () => h('button', { type: 'button' }, 'Сохранить') }
  });

  const dialog = await screen.findByRole('dialog', { name: 'Настройки', description: 'Настройки звонка' });
  expect(dialog.classList.contains('ui-dialog--lg')).toBe(true);
  expect(dialog.contains(screen.getByRole('button', { name: 'Сохранить' }))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
});

test('a press outside the card closes, a press inside does not', async () => {
  const { onClosed, dialog } = await openDialog();
  await userEvent.click(dialog);
  expect(onClosed).not.toHaveBeenCalled();

  const overlay = dialog.parentElement;
  if (!overlay) throw new Error('dialog has no overlay');
  // jsdom has no stylesheet, so the body lock's pointer-events: none is not undone by our CSS.
  await userEvent.setup({ pointerEventsCheck: 0 }).click(overlay);
  expect(onClosed).toHaveBeenCalledTimes(1);
});

test('a press on a toast raised over the dialog does not close it', async () => {
  const onAction = vi.fn();
  const { onClosed } = await openDialog([
    { id: 't1', message: 'Сохранено', actions: [{ label: 'Отменить', onClick: onAction }] }
  ]);

  // Same jsdom limit as above: the press itself is what is under test.
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(screen.getByRole('button', { name: 'Отменить', hidden: true }));

  expect(onAction).toHaveBeenCalledWith('t1');
  expect(onClosed).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

test.each([false, true])(
  'the panel exposes the right modality and preserves the trigger (modal: %s)',
  async (modal) => {
    const outsideAction = vi.fn();
    const Host = defineComponent(() => {
      const open = ref(false);
      return () => [
        h('button', { onClick: () => (open.value = !open.value) }, 'Чат'),
        h('button', { onClick: outsideAction }, 'Следующее действие'),
        h(
          UiDialog,
          { open: open.value, title: 'Чат встречи', layout: 'panel', modal, onClose: () => (open.value = false) },
          () => h('input', { 'aria-label': 'Сообщение' })
        )
      ];
    });
    const { container } = render(Host);
    const trigger = screen.getByRole('button', { name: 'Чат' });
    await userEvent.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Чат встречи' });
    expect(container.contains(panel)).toBe(!modal);
    expect(panel.getAttribute('aria-modal')).toBe(modal ? 'true' : null);

    if (!modal) {
      const close = screen.getByRole('button', { name: 'Закрыть' });
      await vi.waitFor(() => expect(document.activeElement).toBe(close));
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Следующее действие' }));
      await userEvent.click(screen.getByRole('button', { name: 'Следующее действие' }));
      await userEvent.keyboard('{Escape}');
      expect(outsideAction).toHaveBeenCalledOnce();
      expect(screen.getByRole('dialog')).toBe(panel);
    }

    await userEvent.click(screen.getByRole('textbox', { name: 'Сообщение' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  }
);
