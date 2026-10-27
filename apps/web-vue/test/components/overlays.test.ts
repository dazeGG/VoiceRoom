import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { ContextMenu } from '@/shared/ui/ContextMenu';
import { PopoverMenuItem } from '@/shared/ui/Popover';
import { popoverHarness } from './PopoverHarness';
import { settle, stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

afterEach(() => vi.restoreAllMocks());

// A context menu with a disabled item between two enabled ones and a button outside it.
function contextMenuHarness(props: { onClose: () => void; restoreFocus?: HTMLElement }) {
  return defineComponent(() => {
    const open = ref(true);
    return () => [
      h('button', { type: 'button' }, 'Снаружи'),
      h(
        ContextMenu,
        {
          open: open.value,
          x: 20,
          y: 20,
          ariaLabel: 'Действия с комнатой',
          restoreFocus: props.restoreFocus ?? null,
          onClose: () => {
            props.onClose();
            open.value = false;
          }
        },
        {
          default: () => [
            h(PopoverMenuItem, { label: 'Открыть' }),
            h(PopoverMenuItem, { label: 'Недоступно', disabled: true }),
            h(PopoverMenuItem, { label: 'Удалить из списка' })
          ]
        }
      )
    ];
  });
}

test('a popover opens from its trigger and Escape closes it and returns focus to the trigger', async () => {
  render(popoverHarness({ label: 'Меню' }));
  const trigger = screen.getByRole('button', { name: 'Меню' });
  await userEvent.click(trigger);
  expect(await screen.findByRole('menu', { name: 'Меню Меню' })).toBeTruthy();

  await settle();
  await userEvent.keyboard('{Escape}');
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('a click outside closes a popover without stealing focus back', async () => {
  render(popoverHarness());
  await userEvent.click(screen.getByRole('button', { name: 'open' }));
  await screen.findByRole('menu');
  await userEvent.click(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

test('a popover can veto closing', async () => {
  const onBeforeClose = vi.fn(() => false);
  render(popoverHarness({ onBeforeClose }));
  await userEvent.click(screen.getByRole('button', { name: 'open' }));
  await screen.findByRole('menu');
  await settle();
  await userEvent.keyboard('{Escape}');
  expect(onBeforeClose).toHaveBeenCalledWith('escape');
  expect(screen.getByRole('menu')).toBeTruthy();
});

test('a context menu focuses its first item, skips disabled ones and wraps with the arrow keys', async () => {
  render(contextMenuHarness({ onClose: vi.fn() }));
  await screen.findByRole('menu', { name: 'Действия с комнатой' });
  await settle();
  const focused = () => document.activeElement?.textContent?.trim();
  expect(focused()).toBe('Открыть');
  await userEvent.keyboard('{ArrowDown}');
  expect(focused()).toBe('Удалить из списка');
  await userEvent.keyboard('{ArrowDown}');
  expect(focused()).toBe('Открыть');
  await userEvent.keyboard('{End}');
  expect(focused()).toBe('Удалить из списка');
});

test('Escape closes a context menu and gives focus back to what opened it', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  const onClose = vi.fn();
  render(contextMenuHarness({ onClose, restoreFocus: opener }));
  await screen.findByRole('menu');
  await settle();

  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.activeElement).toBe(opener));
  opener.remove();
});

test('pressing outside or resizing the window closes a context menu', async () => {
  const onClose = vi.fn();
  const first = render(contextMenuHarness({ onClose }));
  await screen.findByRole('menu');
  await settle();
  await userEvent.click(document.body);
  expect(onClose).toHaveBeenCalledTimes(1);
  first.unmount();

  const onResizeClose = vi.fn();
  render(contextMenuHarness({ onClose: onResizeClose }));
  await screen.findByRole('menu');
  window.dispatchEvent(new Event('resize'));
  expect(onResizeClose).toHaveBeenCalledTimes(1);
});
