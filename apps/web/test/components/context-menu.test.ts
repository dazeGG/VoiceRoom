import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { ContextMenu, ContextMenuHeaderButton, MenuItem } from '@voiceroom/ui-kit/components';
import { settle, stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

const items = () => [
  h(MenuItem, { label: 'Первый' }),
  h(MenuItem, { label: 'Второй' }),
  h(MenuItem, { label: 'Третий' })
];

const focused = () => document.activeElement?.textContent?.trim();

function renderMenu(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const view = render(ContextMenu, {
    props: { open: true, x: 40, y: 50, ariaLabel: 'Контекстное меню', onClose, ...props },
    slots: { default: items }
  });
  return { ...view, onClose };
}

describe('ContextMenu', () => {
  test('opens a labelled menu with the first item focused', async () => {
    renderMenu();
    expect(await screen.findByRole('menu', { name: 'Контекстное меню' })).toBeTruthy();
    await settle();
    expect(focused()).toBe('Первый');
  });

  test('arrow keys, Home and End move between the items and wrap', async () => {
    renderMenu();
    await screen.findByRole('menu');
    await settle();
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Второй');
    await userEvent.keyboard('{End}');
    expect(focused()).toBe('Третий');
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Первый');
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Третий');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('Первый');
  });

  test('the reactions header exposes a toolbar with operable buttons', async () => {
    const onReact = vi.fn();
    render(ContextMenu, {
      props: { open: true, x: 40, y: 50, ariaLabel: 'Действия', headerLabel: 'Быстрые реакции' },
      slots: {
        default: items,
        header: () => h(ContextMenuHeaderButton, { label: 'Поддержать', pressed: true, onClick: onReact })
      }
    });
    expect(await screen.findByRole('toolbar', { name: 'Быстрые реакции' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Поддержать', pressed: true });
    await userEvent.click(button);
    expect(onReact).toHaveBeenCalledOnce();
  });

  test('Escape and a press outside ask to close', async () => {
    const { onClose } = renderMenu();
    await screen.findByRole('menu');
    await settle();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('closing with Escape returns focus to the element that opened the menu, a press outside does not', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const Harness = defineComponent({
      setup() {
        const open = ref(true);
        return () =>
          h(
            ContextMenu,
            {
              open: open.value,
              x: 10,
              y: 10,
              ariaLabel: 'Меню',
              restoreFocus: opener,
              onClose: () => (open.value = false)
            },
            { default: items }
          );
      }
    });
    const escaped = render(Harness);
    await screen.findByRole('menu');
    await settle();
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
    escaped.unmount();

    opener.blur();
    render(Harness);
    await screen.findByRole('menu');
    await settle();
    await userEvent.click(document.body);
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(opener);
    opener.remove();
  });

  test('a consumer that keeps the menu open and opens it again gets focus restored on the next close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const onClose = vi.fn();
    const view = render(ContextMenu, {
      props: { open: true, x: 1, y: 1, ariaLabel: 'Меню', restoreFocus: opener, onClose },
      slots: { default: items }
    });
    await screen.findByRole('menu');
    await settle();
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.rerender({ open: false });
    await view.rerender({ open: true });
    await screen.findByRole('menu');
    await settle();
    await userEvent.keyboard('{Escape}');
    await view.rerender({ open: false });
    await settle();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test('moving the point while the menu is open places it again and focuses its first item', async () => {
    const view = renderMenu();
    await screen.findByRole('menu');
    await settle();
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Второй');

    await view.rerender({ x: 200, y: 120 });
    await settle();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(focused()).toBe('Первый');
  });

  test('a window resize closes it, and so does a scroll outside the menu but not one inside it', async () => {
    const { onClose } = renderMenu();
    const menu = await screen.findByRole('menu');
    await settle();

    await fireEvent.scroll(menu);
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.scroll(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(window, new Event('resize'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
