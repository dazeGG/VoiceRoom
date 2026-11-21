import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { h } from 'vue';
import { Field, Select, TextField } from '@voice-room/ui/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

beforeEach(stubOverlayDom);

test('the optional field label focuses the input and describes it with the hint', async () => {
  render(Field, {
    props: { label: 'Город', optional: true, hint: 'Укажите город проживания' },
    slots: { default: () => h(TextField) }
  });
  const input = screen.getByRole('textbox', { name: 'Город · необязательно' });
  await userEvent.click(screen.getByText('Город'));
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Укажите город проживания').id);
});

test('the error is the accessible description of the invalid input and replaces the hint', async () => {
  render(Field, {
    props: { label: 'Почта', error: 'Проверьте адрес', hint: 'Адрес для входа' },
    slots: { default: () => h(TextField) }
  });
  const input = screen.getByRole('textbox', { name: 'Почта', description: 'Проверьте адрес' });
  await userEvent.tab();
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Проверьте адрес').id);
  expect(screen.queryByText('Адрес для входа')).toBeNull();
});

test('an existing Select can use the Field label and validation description', () => {
  render(Field, {
    props: { label: 'Устройство', error: 'Выберите устройство' },
    slots: { default: () => h(Select, { options: [{ value: 'default', label: 'По умолчанию' }] }) }
  });
  const select = screen.getByRole('combobox', { name: 'Устройство', description: 'Выберите устройство' });
  expect(select.getAttribute('aria-invalid')).toBe('true');
});

test('the clear button clears the field, emits the empty value and returns focus', async () => {
  const view = render(TextField, { props: { clearable: true }, attrs: { 'aria-label': 'Поиск' } });
  const input = screen.getByRole('textbox', { name: 'Поиск' });
  await userEvent.type(input, 'Мира');
  await userEvent.click(screen.getByRole('button', { name: 'Очистить' }));
  expect(input).toHaveProperty('value', '');
  expect(document.activeElement).toBe(input);
  expect(view.emitted('update:modelValue').at(-1)).toEqual(['']);
  expect(screen.queryByRole('button', { name: 'Очистить' })).toBeNull();
});

test('revealing a password toggles its input type and the pressed state', async () => {
  render(Field, {
    props: { label: 'Пароль' },
    slots: { default: () => h(TextField, { type: 'password' }) }
  });
  const input = screen.getByLabelText('Пароль');
  expect(input.getAttribute('type')).toBe('password');
  await userEvent.click(screen.getByRole('button', { name: 'Показать пароль', pressed: false }));
  expect(input.getAttribute('type')).toBe('text');
  await userEvent.click(screen.getByRole('button', { name: 'Скрыть пароль', pressed: true }));
  expect(input.getAttribute('type')).toBe('password');
  expect(screen.getByRole('button', { name: 'Показать пароль', pressed: false })).toBeTruthy();
});
