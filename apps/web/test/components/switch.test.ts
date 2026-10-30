import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Switch from '@/shared/ui/Switch/Switch.vue';

test('click and Space toggle the switch through v-model', async () => {
  const onUpdate = vi.fn();
  render(Switch, { props: { modelValue: false, ariaLabel: 'Шумоподавление', 'onUpdate:modelValue': onUpdate } });
  const toggle = screen.getByRole('switch', { name: 'Шумоподавление' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await userEvent.click(toggle);
  expect(onUpdate).toHaveBeenLastCalledWith(true);
  toggle.focus();
  await userEvent.keyboard(' ');
  expect(onUpdate).toHaveBeenCalledTimes(2);
});

test('reflects the checked state in aria-checked', () => {
  render(Switch, { props: { modelValue: true, ariaLabel: 'Звук' } });
  expect(screen.getByRole('switch', { name: 'Звук' }).getAttribute('aria-checked')).toBe('true');
});

test('a disabled switch does not toggle', async () => {
  const onUpdate = vi.fn();
  render(Switch, { props: { modelValue: false, disabled: true, ariaLabel: 'Звук', 'onUpdate:modelValue': onUpdate } });
  await userEvent.click(screen.getByRole('switch', { name: 'Звук' }));
  expect(onUpdate).not.toHaveBeenCalled();
});
