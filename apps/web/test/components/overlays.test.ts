import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import ContextMenuHarness from './harness/ContextMenuHarness.svelte';
import PopoverHarness from './harness/PopoverHarness.svelte';

afterEach(cleanup);

test('a popover opens from its trigger and Escape closes it and returns focus to the trigger', async () => {
  render(PopoverHarness);
  const trigger = screen.getByRole('button', { name: 'Меню' });
  await userEvent.click(trigger);
  expect(screen.getByRole('menu', { name: 'Меню' })).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('a click outside closes a popover without stealing focus back', async () => {
  render(PopoverHarness);
  await userEvent.click(screen.getByRole('button', { name: 'Меню' }));
  const outside = screen.getByRole('button', { name: 'Снаружи' });
  await userEvent.click(outside);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

test('a popover can veto closing', async () => {
  const onBeforeClose = vi.fn(() => false);
  render(PopoverHarness, { props: { onBeforeClose } });
  await userEvent.click(screen.getByRole('button', { name: 'Меню' }));
  await userEvent.keyboard('{Escape}');
  expect(onBeforeClose).toHaveBeenCalledWith('escape');
  expect(screen.getByRole('menu')).toBeTruthy();
});

test('a context menu focuses its first item, skips disabled ones and wraps with the arrow keys', async () => {
  render(ContextMenuHarness, { props: { onClose: vi.fn() } });
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Открыть'));
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement?.textContent).toBe('Удалить из списка');
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement?.textContent).toBe('Открыть');
  await userEvent.keyboard('{End}');
  expect(document.activeElement?.textContent).toBe('Удалить из списка');
});

test('Escape closes a context menu and gives focus back to what opened it', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  const onClose = vi.fn();
  render(ContextMenuHarness, { props: { onClose, restoreFocus: opener } });
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Открыть'));

  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.activeElement).toBe(opener));
  opener.remove();
});

test('pressing outside or resizing the window closes a context menu', async () => {
  const onClose = vi.fn();
  render(ContextMenuHarness, { props: { onClose } });
  await userEvent.click(screen.getByRole('button', { name: 'Снаружи' }));
  expect(onClose).toHaveBeenCalledTimes(1);

  cleanup();
  const onResizeClose = vi.fn();
  render(ContextMenuHarness, { props: { onClose: onResizeClose } });
  window.dispatchEvent(new Event('resize'));
  expect(onResizeClose).toHaveBeenCalledTimes(1);
});

test('a context menu opened near the window edge stays inside the window', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 150, top: 0, left: 0, right: 200, bottom: 150, x: 0, y: 0, toJSON() {} });
  render(ContextMenuHarness, { props: { onClose: vi.fn(), x: window.innerWidth - 10, y: window.innerHeight - 10 } });
  const menu = await screen.findByRole('menu', { name: 'Действия с комнатой' });
  await waitFor(() => expect(menu.style.left).toBe(`${window.innerWidth - 200 - 8}px`));
  expect(menu.style.top).toBe(`${window.innerHeight - 150 - 8}px`);
  vi.restoreAllMocks();
});
