import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Select from '@/shared/ui/Select/Select.vue';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

const options = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'headset', label: 'Гарнитура' },
  { value: 'speakers', label: 'Колонки' },
  { value: 'hdmi', label: 'HDMI' }
];

function renderSelect(value = 'default') {
  const onValueChange = vi.fn();
  render(Select, { props: { modelValue: value, options, label: 'Устройство вывода', onValueChange } });
  const trigger = screen.getByRole('combobox', { expanded: false });
  return { onValueChange, trigger };
}

const focused = () => document.activeElement?.textContent?.trim();

// Reka's Select trigger has role="combobox" (the Svelte one was a button with aria-haspopup="listbox").
test('the trigger shows the chosen option and opens a listbox focused on it', async () => {
  const { trigger } = renderSelect('speakers');
  expect(trigger.textContent).toContain('Колонки');
  expect(trigger.getAttribute('role')).toBe('combobox');

  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(screen.getAllByRole('option')).toHaveLength(4);
  expect(screen.getByRole('option', { name: 'Колонки' }).getAttribute('aria-selected')).toBe('true');
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
  render(Select, { props: { modelValue: 'default', options, label: 'Устройство', disabled: true } });
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('an option with the empty value can be shown, chosen and left again', async () => {
  const onValueChange = vi.fn();
  const devices = [{ value: '', label: 'Системный' }, ...options.slice(1)];
  render(Select, { props: { modelValue: '', options: devices, label: 'Устройство', onValueChange } });
  const trigger = screen.getByRole('combobox');
  expect(trigger.textContent).toContain('Системный');

  await userEvent.click(trigger);
  expect(screen.getByRole('option', { name: 'Системный' }).getAttribute('aria-selected')).toBe('true');
  await userEvent.click(screen.getByRole('option', { name: 'Гарнитура' }));
  expect(onValueChange).toHaveBeenLastCalledWith('headset');

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('option', { name: 'Системный' }));
  expect(onValueChange).toHaveBeenLastCalledWith('');
});

test('a select without options does not open', async () => {
  render(Select, { props: { modelValue: '', options: [], label: 'Пусто' } });
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('listbox')).toBeNull();
});
