import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Combobox } from '@voiceroom/ui-kit/components';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

const options = [
  { value: 'anya', label: 'Аня', searchText: 'Аня anya' },
  { value: 'oleg', label: 'Олег', disabled: true },
  { value: 'mira', label: 'Мира' }
];

test('combobox filters by search text and commits a choice without moving focus', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(Combobox, { props: { label: 'Найти друга', options, onSelect } });
  const input = screen.getByRole('combobox', { name: 'Найти друга' });

  await user.type(input, 'any');
  await screen.findByRole('option', { name: 'Аня' });
  expect(screen.queryByRole('option', { name: 'Мира' })).toBeNull();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalledWith(options[0]);
  expect(input).toHaveProperty('value', 'Аня');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(input);
});

test('combobox skips disabled options, shows an empty result and closes with Escape', async () => {
  const user = userEvent.setup();
  render(Combobox, { props: { label: 'Найти друга', options } });
  const input = screen.getByRole('combobox', { name: 'Найти друга' });
  await user.tab();
  const mira = await screen.findByRole('option', { name: 'Мира' });

  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBe(mira.id));
  await user.type(input, 'xyz');
  expect((await screen.findByRole('status')).textContent).toBe('Ничего не найдено');
  await user.keyboard('{Escape}');
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(input);
});
