import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Button from '../../src/shared/ui/Button/Button.vue';

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
