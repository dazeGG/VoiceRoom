import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { popoverHarness } from './PopoverHarness';
import type { PopoverHarnessProps } from './PopoverHarness';
import { settle, stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

function renderPopover(props: PopoverHarnessProps = {}) {
  const view = render(popoverHarness(props));
  return { ...view, trigger: screen.getByRole('button', { name: props?.label ?? 'open' }) };
}

const focused = () => document.activeElement?.textContent?.trim();

describe('Popover', () => {
  test('the trigger opens a labelled menu whose first item is focused', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);
    expect(await screen.findByRole('menu', { name: 'Меню open' })).toBeTruthy();
    await settle();
    expect(focused()).toBe('open A');
  });

  test('arrow keys, Home and End move between the items and wrap', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);
    await settle();
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('open B');
    await userEvent.keyboard('{End}');
    expect(focused()).toBe('open C');
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('open A');
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('open C');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('open A');
  });

  test('Escape closes the menu and returns focus to the trigger', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);
    await settle();
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('a press outside closes the menu; a press inside it does not', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'open B' }));
    expect(screen.queryByRole('menu')).not.toBeNull();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('onBeforeClose can veto Escape and an outside press, and is told the reason', async () => {
    const onBeforeClose = vi.fn(() => false as const);
    const { trigger } = renderPopover({ onBeforeClose });
    await userEvent.click(trigger);
    await settle();
    await userEvent.keyboard('{Escape}');
    expect(onBeforeClose).toHaveBeenLastCalledWith('escape');
    await userEvent.click(document.body);
    expect(onBeforeClose).toHaveBeenLastCalledWith('outside');
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  test('a panel that is not floating sits next to its trigger; a floating one goes to the body', async () => {
    const view = renderPopover();
    await userEvent.click(view.trigger);
    expect(view.trigger.parentElement?.contains(await screen.findByRole('menu'))).toBe(true);
    view.unmount();

    const floating = renderPopover({ floating: true });
    await userEvent.click(floating.trigger);
    expect(floating.trigger.parentElement?.contains(await screen.findByRole('menu'))).toBe(false);
  });

  test('the panel carries the role and id of the popover and no empty aria-labelledby', async () => {
    const { trigger } = renderPopover({ role: 'dialog' });
    await userEvent.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Меню open' });
    expect(panel.id).toBe(trigger.getAttribute('aria-controls'));
    expect(panel.hasAttribute('aria-labelledby')).toBe(false);
  });

  test('a press inside a submenu does not close the popover that owns it; Escape closes only the submenu', async () => {
    renderPopover({ withSubmenu: true });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const row = await screen.findByRole('menuitem', { name: 'Ещё' });
    await userEvent.click(row);
    const nested = await screen.findByRole('menuitem', { name: 'Вложенный' });
    await userEvent.click(nested);
    expect(screen.queryByRole('menu', { name: 'Меню open' })).not.toBeNull();

    nested.focus();
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('menuitem', { name: 'Вложенный' })).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(screen.queryByRole('menu', { name: 'Меню open' })).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  describe('keepContentMounted', () => {
    test('the closed panel stays in the DOM, hidden, and opening it focuses its first item', async () => {
      const { trigger } = renderPopover({ keepContentMounted: true });
      const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
      expect(panel?.hidden).toBe(true);
      expect(panel?.getAttribute('aria-hidden')).toBe('true');

      await userEvent.click(trigger);
      await settle();
      expect(panel?.hidden).toBe(false);
      expect(focused()).toBe('open A');

      await userEvent.keyboard('{Escape}');
      await settle();
      expect(panel?.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
    });

    test('a closed kept panel neither takes Escape nor reports outside presses', async () => {
      const closedVeto = vi.fn();
      render(popoverHarness({ label: 'first' }));
      render(popoverHarness({ label: 'second', keepContentMounted: true, onBeforeClose: closedVeto }));
      await userEvent.click(screen.getByRole('button', { name: 'first' }));
      await settle();
      await userEvent.keyboard('{Escape}');
      await settle();
      expect(screen.queryByRole('menu', { name: 'Меню first' })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'first' }));
      await userEvent.click(document.body);
      expect(closedVeto).not.toHaveBeenCalled();
    });
  });
});
