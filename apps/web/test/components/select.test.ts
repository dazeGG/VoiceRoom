import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import Select from '../../src/lib/shared/ui/Select/Select.svelte';

afterEach(cleanup);

const options = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'headset', label: 'Гарнитура' },
  { value: 'speakers', label: 'Колонки' },
  { value: 'hdmi', label: 'HDMI' }
];

function renderSelect(value = 'default') {
  const onValueChange = vi.fn();
  render(Select, { props: { value, options, label: 'Устройство вывода', onValueChange } });
  const trigger = screen.getByRole('button', { expanded: false });
  return { onValueChange, trigger };
}

const focused = () => document.activeElement?.textContent?.trim();

test('the trigger shows the chosen option and opens a listbox focused on it', async () => {
  const { trigger } = renderSelect('speakers');
  expect(trigger.textContent).toContain('Колонки');
  expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');

  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(focused()).toBe('Колонки');
});

test('arrow keys wrap, Home and End jump, Enter chooses and closes', async () => {
  const { trigger, onValueChange } = renderSelect();
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard('{ArrowUp}');
  expect(focused()).toBe('HDMI');
  await userEvent.keyboard('{Home}');
  expect(focused()).toBe('По умолчанию');
  await userEvent.keyboard('{End}');
  expect(focused()).toBe('HDMI');
  await userEvent.keyboard('{ArrowDown}');
  expect(focused()).toBe('По умолчанию');
  await userEvent.keyboard('{ArrowDown}{Enter}');

  expect(onValueChange).toHaveBeenCalledWith('headset');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(trigger.textContent).toContain('Гарнитура');
});

test('typing jumps to the option that starts with the typed letters', async () => {
  const { trigger } = renderSelect();
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard('к');
  expect(focused()).toBe('Колонки');
});

test('Escape closes without changing the value; choosing the current value reports nothing', async () => {
  const { trigger, onValueChange } = renderSelect();
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(trigger.textContent).toContain('По умолчанию');

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('option', { name: 'По умолчанию' }));
  expect(onValueChange).not.toHaveBeenCalled();
});

test('a disabled select does not open', async () => {
  render(Select, { props: { value: 'default', options, label: 'Устройство', disabled: true } });
  await userEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('listbox')).toBeNull();
});
