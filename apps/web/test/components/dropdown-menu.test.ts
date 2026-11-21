import { render, screen, waitFor, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Dialog, DropdownMenu, MenuCheckboxItem, MenuItem, MenuSub } from '@voice-room/ui/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

function renderMenu() {
  const onSelect = vi.fn();
  render(
    defineComponent(() => {
      const checked = ref<boolean | 'indeterminate'>(false);
      return () =>
        h(
          DropdownMenu,
          { ariaLabel: 'Действия' },
          {
            trigger: () => h('button', { type: 'button' }, 'Открыть'),
            content: () => [
              h(MenuItem, { label: 'Копировать' }),
              h(MenuItem, { label: 'Пригласить', onSelect }),
              h(MenuCheckboxItem, {
                label: 'Отключить звук',
                modelValue: checked.value,
                'onUpdate:modelValue': (value: boolean | 'indeterminate') => (checked.value = value),
                onSelect: (event: Event) => event.preventDefault()
              }),
              h(
                MenuSub,
                { label: 'Уведомления' },
                {
                  default: () =>
                    h(MenuItem, { label: 'Только упоминания', onSelect: (event: Event) => event.preventDefault() })
                }
              )
            ]
          }
        );
    })
  );
  return { onSelect, trigger: screen.getByRole('button', { name: 'Открыть' }) };
}

test('the trigger opens a labelled menu and Escape gives focus back to it', async () => {
  const { trigger } = renderMenu();
  await userEvent.click(trigger);
  expect(await screen.findByRole('menu', { name: 'Действия' })).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('arrows move focus and Enter selects and closes the menu', async () => {
  const { onSelect } = renderMenu();
  await userEvent.tab();
  await userEvent.keyboard('{ArrowDown}');
  const first = await screen.findByRole('menuitem', { name: 'Копировать' });
  await waitFor(() => expect(document.activeElement).toBe(first));
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Пригласить' }));
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('selecting a checkbox changes its accessible checked state', async () => {
  const { trigger } = renderMenu();
  await userEvent.click(trigger);
  const item = await screen.findByRole('menuitemcheckbox', { name: 'Отключить звук', checked: false });
  await userEvent.click(item);
  expect(screen.getByRole('menuitemcheckbox', { name: 'Отключить звук', checked: true })).toBe(item);
});

test.each(['{ArrowLeft}', '{Escape}'])('Right opens the submenu and %s returns to its trigger', async (closeKey) => {
  renderMenu();
  await userEvent.tab();
  await userEvent.keyboard('{ArrowDown}');
  const menu = await screen.findByRole('menu', { name: 'Действия' });
  const row = within(menu).getByRole('menuitem', { name: 'Уведомления' });
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(row);
  await userEvent.keyboard('{ArrowRight}');
  const nested = await screen.findByRole('menuitem', { name: 'Только упоминания' });
  expect(row.getAttribute('aria-expanded')).toBe('true');
  await userEvent.click(nested);
  expect(screen.getByRole('menu', { name: 'Действия' })).toBe(menu);
  await userEvent.keyboard(closeKey);
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Только упоминания' })).toBeNull());
  expect(document.activeElement).toBe(row);
  expect(screen.getByRole('menu', { name: 'Действия' })).toBe(menu);
});

test('a menu in a modal stays inside its focus scope', async () => {
  render(
    defineComponent(
      () => () =>
        h(
          Dialog,
          {
            open: true,
            title: 'Настройки комнаты',
            onClose: vi.fn()
          },
          {
            default: () =>
              h(
                DropdownMenu,
                { ariaLabel: 'Действия участника' },
                {
                  trigger: () => h('button', { type: 'button' }, 'Открыть действия'),
                  content: () =>
                    h(
                      MenuSub,
                      { label: 'Заблокировать' },
                      {
                        default: () => h(MenuItem, { label: 'На час' })
                      }
                    )
                }
              )
          }
        )
    )
  );
  const dialog = await screen.findByRole('dialog', { name: 'Настройки комнаты' });
  const trigger = within(dialog).getByRole('button', { name: 'Открыть действия' });
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  const submenu = await within(dialog).findByRole('menuitem', { name: 'Заблокировать' });
  await waitFor(() => expect(document.activeElement).toBe(submenu));
  await userEvent.keyboard('{ArrowRight}');
  const option = await within(dialog).findByRole('menuitem', { name: 'На час' });
  await waitFor(() => expect(document.activeElement).toBe(option));
});
