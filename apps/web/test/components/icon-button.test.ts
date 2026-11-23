import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { IconButton } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

beforeEach(stubOverlayDom);

test('an icon button has its required accessible label and forwards its click', async () => {
  const onclick = vi.fn();
  render(IconButton, { props: { label: 'Закрыть' }, attrs: { onClick: onclick } });
  const button = screen.getByRole('button', { name: 'Закрыть' });
  expect(button.getAttribute('aria-label')).toBe('Закрыть');
  expect(button.hasAttribute('title')).toBe(false);
  expect(button.getAttribute('type')).toBe('button');
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledTimes(1);
});

test('keyboard focus shows a tooltip with the same label and Escape closes it', async () => {
  render(IconButton, { props: { label: 'Выключить микрофон', shortcut: ['Ctrl', 'M'] } });
  const button = screen.getByRole('button', { name: 'Выключить микрофон' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await userEvent.tab();
  expect(document.activeElement).toBe(button);
  const tooltip = await screen.findByRole('tooltip', { name: 'Выключить микрофон' });
  expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  expect(Array.from(document.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['Ctrl', 'M']);
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  expect(document.activeElement).toBe(button);
});

test('tooltip false keeps the labelled button and click handler without a tooltip', async () => {
  const onclick = vi.fn();
  render(IconButton, { props: { label: 'Закрыть', tooltip: false }, attrs: { onClick: onclick } });
  const button = screen.getByRole('button', { name: 'Закрыть' });
  await userEvent.tab();
  expect(document.activeElement).toBe(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledTimes(1);
});

test('pressed and expanded states reach the actual button', () => {
  render(IconButton, {
    props: { label: 'Открыть меню' },
    attrs: { 'aria-pressed': true, 'aria-expanded': true }
  });
  const button = screen.getByRole('button', { name: 'Открыть меню', pressed: true, expanded: true });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-expanded')).toBe('true');
});

test('a disabled icon button ignores pointer and keyboard input', async () => {
  const onclick = vi.fn();
  render(IconButton, { props: { label: 'Закрыть', disabled: true }, attrs: { onClick: onclick } });
  const button = screen.getByRole('button', { name: 'Закрыть' });
  expect(button).toHaveProperty('disabled', true);
  await userEvent.click(button);
  await userEvent.tab();
  expect(document.activeElement).not.toBe(button);
  expect(onclick).not.toHaveBeenCalled();
});
