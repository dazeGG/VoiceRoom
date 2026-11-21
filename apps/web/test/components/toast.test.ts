import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { Dialog, Toast } from '@voiceroom/ui-kit/components';
import type { ToastItem } from '@voiceroom/ui-kit/toast';

const message = 'Настройки сохранены';

function mountToasts(initial: ToastItem[], dialogState?: 'open' | 'closed') {
  const dismiss = vi.fn();
  const close = vi.fn();
  render(
    defineComponent({
      setup() {
        const toasts = ref(initial);
        const open = ref(dialogState === 'open');
        function openDialog(): void {
          open.value = true;
        }
        function closeDialog(): void {
          open.value = false;
          close();
        }
        return () => [
          h(Toast, {
            toasts: toasts.value,
            onDismiss(id: string) {
              dismiss(id);
              toasts.value = toasts.value.filter((item) => item.id !== id);
            }
          }),
          dialogState ? h('button', { type: 'button', onClick: openDialog }, 'Открыть настройки') : null,
          dialogState ? h(Dialog, { open: open.value, title: 'Настройки', onClose: closeDialog }) : null
        ];
      }
    })
  );
  return { dismiss, close };
}

const viewport = () => within(screen.getByRole('region', { name: /Уведомления.*F8/ }));

test('renders the message, description and a single action that receives the toast ID', async () => {
  const onClick = vi.fn();
  mountToasts([
    {
      id: 'saved',
      message,
      description: 'Изменения применены',
      actions: [
        { label: 'Отменить', onClick },
        { label: 'Второе действие', onClick }
      ]
    }
  ]);

  expect(await viewport().findByText(message)).toBeTruthy();
  expect(viewport().getByText('Изменения применены')).toBeTruthy();
  expect(viewport().queryByRole('button', { name: 'Второе действие' })).toBeNull();
  await userEvent.click(viewport().getByRole('button', { name: 'Отменить' }));
  expect(onClick).toHaveBeenCalledExactlyOnceWith('saved');
});

test('auto-dismisses after five seconds of visible time and pauses while hovered', async () => {
  vi.useFakeTimers();
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { dismiss } = mountToasts([{ id: 'saved', message }]);
    await nextTick();
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    const toast = viewport().getByRole('listitem');
    await user.hover(toast);
    await vi.advanceTimersByTimeAsync(5000);
    expect(dismiss).not.toHaveBeenCalled();

    await user.unhover(toast);
    await vi.advanceTimersByTimeAsync(2999);
    expect(dismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dismiss).toHaveBeenCalledExactlyOnceWith('saved');
    expect(viewport().queryByText(message)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('F8 focuses the viewport and dismissing one toast shows the next queued item', async () => {
  const firstMessage = 'Ссылка скопирована';
  const items = [firstMessage, 'Заявка отправлена', 'Комната создана', message];
  mountToasts(items.map((message, index) => ({ id: String(index), message, duration: 0 })));
  const region = screen.getByRole('region', { name: /Уведомления.*F8/ });
  await within(region).findByText(firstMessage);
  expect(viewport().getAllByRole('listitem')).toHaveLength(3);
  expect(viewport().queryByText(message)).toBeNull();

  await userEvent.keyboard('{F8}');
  expect(document.activeElement).toBe(viewport().getByRole('list'));
  const first = viewport().getAllByRole('listitem')[0];
  if (!first) throw new Error('No visible toasts');
  await userEvent.click(within(first).getByRole('button', { name: 'Закрыть уведомление' }));
  expect(await viewport().findByText(message)).toBeTruthy();
  expect(viewport().getAllByRole('listitem')).toHaveLength(3);
});

test('pressing a toast action leaves the open dialog in place', async () => {
  const onClick = vi.fn();
  const toasts = [{ id: 'saved', message, actions: [{ label: 'Отменить', onClick }] }];
  const { close } = mountToasts(toasts, 'open');

  const action = await screen.findByText('Отменить');
  await userEvent.setup({ pointerEventsCheck: 0 }).click(action);
  expect(onClick).toHaveBeenCalledExactlyOnceWith('saved');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeTruthy();
});

test('Escape closes the focused dialog while an existing toast stays visible', async () => {
  const { dismiss } = mountToasts([{ id: 'saved', message, duration: 0 }], 'closed');

  await viewport().findByText(message);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Открыть настройки' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  await user.keyboard('{Escape}');

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(dismiss).not.toHaveBeenCalled();
  expect(viewport().getByText(message)).toBeTruthy();
});
