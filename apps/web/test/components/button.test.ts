import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Button } from '@voiceroom/ui-kit/components';

test('a button is disabled and does not fire its handler while disabled', async () => {
  const onclick = vi.fn();
  render(Button, { props: { disabled: true }, attrs: { onClick: onclick } });
  const button = screen.getByRole('button');
  expect(button).toHaveProperty('disabled', true);
  await userEvent.click(button);
  expect(onclick).not.toHaveBeenCalled();
});

test('a button reports clicks and defaults to type="button" so it never submits a form', async () => {
  const onclick = vi.fn();
  render(Button, { attrs: { onClick: onclick } });
  const button = screen.getByRole('button');
  expect(button.getAttribute('type')).toBe('button');
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledTimes(1);
});

test('the small plain button keeps its size and variant classes', () => {
  render(Button, { props: { size: 'sm', variant: 'plain' }, slots: { default: 'Отмена' } });
  const button = screen.getByRole('button', { name: 'Отмена' });
  expect(button.classList.contains('ui-button--size-sm')).toBe(true);
  expect(button.classList.contains('ui-button--plain')).toBe(true);
});

test('a busy button is announced as busy, replaces its icon and ignores clicks', async () => {
  const onclick = vi.fn();
  const view = render(Button, {
    props: { busy: true },
    attrs: { onClick: onclick },
    slots: { default: 'Создаём…', icon: '<span>Иконка создания</span>' }
  });
  const button = screen.getByRole('button', { name: 'Создаём…' });
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button).toHaveProperty('disabled', true);
  expect(button.contains(screen.getByRole('status', { hidden: true }))).toBe(true);
  expect(screen.queryByText('Иконка создания')).toBeNull();
  await userEvent.click(button);
  expect(onclick).not.toHaveBeenCalled();

  await view.rerender({ busy: false });
  expect(button.getAttribute('aria-busy')).not.toBe('true');
  expect(button).toHaveProperty('disabled', false);
  expect(screen.getByText('Иконка создания')).toBeTruthy();
  expect(screen.queryByRole('status', { hidden: true })).toBeNull();
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledTimes(1);
});
