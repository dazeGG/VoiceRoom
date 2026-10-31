import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { ContextMenu } from '@/shared/ui/ContextMenu';
import { Popover, PopoverMenuItem, type PopoverCloseReason } from '@/shared/ui/Popover';
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

// A popover whose trigger exposes aria-expanded, beside a button outside it.
function popoverWithOutside(onBeforeClose?: (reason: PopoverCloseReason) => boolean | void) {
  return defineComponent(() => {
    const open = ref(false);
    return () => [
      h(
        Popover,
        {
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
          ariaLabel: 'Меню',
          role: 'menu',
          ...(onBeforeClose ? { onBeforeClose } : {})
        },
        {
          trigger: ({ toggle, panelId }: { toggle: () => void; panelId: string }) =>
            h(
              'button',
              { type: 'button', 'aria-expanded': open.value, 'aria-controls': panelId, onClick: toggle },
              'Открыть'
            ),
          content: () => [h(PopoverMenuItem, { label: 'Пункт' })]
        }
      ),
      h('button', { type: 'button' }, 'Снаружи')
    ];
  });
}

test('a popover opens from its trigger and Escape closes it and returns focus to the trigger', async () => {
  render(popoverWithOutside());
  const trigger = screen.getByRole('button', { name: 'Открыть' });
  await userEvent.click(trigger);
  expect(await screen.findByRole('menu', { name: 'Меню' })).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');

  await settle();
  await userEvent.keyboard('{Escape}');
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('a click outside closes a popover without stealing focus back', async () => {
  render(popoverWithOutside());
  await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));
  await screen.findByRole('menu');
  const outside = screen.getByRole('button', { name: 'Снаружи' });
  await userEvent.click(outside);
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test('a popover can veto closing', async () => {
  const onBeforeClose = vi.fn(() => false);
  render(popoverWithOutside(onBeforeClose));
  await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));
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

// Dropped: the Svelte test mocked getBoundingClientRect and asserted the inline left/top the
// menu computed itself to stay inside the window. Reka places the menu with collision
// avoidance (avoid-collisions, collision-padding 8), which jsdom cannot lay out.
