import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import Button from '../../src/lib/shared/ui/Button/Button.svelte';

afterEach(cleanup);

test('a button is disabled and does not fire its handler while disabled', async () => {
  const onclick = vi.fn();
  render(Button, { props: { disabled: true, onclick } });
  const button = screen.getByRole('button');
  expect(button).toHaveProperty('disabled', true);
  await userEvent.click(button);
  expect(onclick).not.toHaveBeenCalled();
});

test('a button reports clicks and defaults to type="button" so it never submits a form', async () => {
  const onclick = vi.fn();
  render(Button, { props: { onclick } });
  const button = screen.getByRole('button');
  expect(button.getAttribute('type')).toBe('button');
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledTimes(1);
});
