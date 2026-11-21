import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Field, Select, type SelectSize } from '@voice-room/ui/components';
import { defineComponent, h, shallowRef } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
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

test('web draws emoji artwork in the selected label and in the option list', async () => {
  render(Select, {
    props: { modelValue: 'headset', options: [{ value: 'headset', label: 'Music 🎵' }] },
    slots: { 'option-label': ({ text }: { text: string }) => h(EmojiText, { text }) }
  });
  const trigger = screen.getByRole('combobox');
  expect(trigger.querySelector('img')?.getAttribute('alt')).toBe('🎵');

  await userEvent.click(trigger);
  expect(screen.getByRole('option').querySelector('img')?.getAttribute('alt')).toBe('🎵');
});

test.each<SelectSize>(['sm', 'md', 'lg'])(
  'select size %s keeps its field label and keyboard selection',
  async (size) => {
    const onValueChange = vi.fn();
    const Host = defineComponent({
      render: () =>
        h(Field, { label: 'Микрофон', error: 'Выберите микрофон' }, () => h(Select, { size, options, onValueChange }))
    });
    render(Host);
    const trigger = screen.getByRole('combobox', { name: 'Микрофон', description: 'Выберите микрофон' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    await userEvent.tab();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('headset');
  }
);

test('the system picker still reports a language change through Select', async () => {
  const onValueChange = vi.fn();
  render(Select, {
    props: {
      native: true,
      label: 'Язык',
      options: [
        { value: '', label: 'Русский' },
        { value: 'fr', label: 'Français', lang: 'fr' }
      ],
      onValueChange
    }
  });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Язык' }), 'fr');
  expect(screen.getByRole('option', { name: 'Français', selected: true })).toBeTruthy();
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('fr');
});

test('the dropdown stays inside its provided theme container', async () => {
  const Host = defineComponent(() => {
    const preview = shallowRef<HTMLElement | null>(null);
    return () => [
      h('section', { ref: preview, 'aria-label': 'Виджет' }),
      h(Select, { label: 'Устройство', options, portalTarget: preview.value ?? undefined })
    ];
  });
  render(Host);
  await userEvent.click(screen.getByRole('combobox', { name: 'Устройство' }));
  expect(within(screen.getByRole('region', { name: 'Виджет' })).getByRole('listbox')).toBeTruthy();
});
