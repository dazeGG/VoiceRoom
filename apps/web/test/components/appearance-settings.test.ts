import { fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import AppearanceSettings from '@/features/home/components/settings/AppearanceSettings.vue';
import { THEMES, THEME_STORAGE_KEY } from '@/shared/theme/theme.store';
import { renderWithApp } from '../helpers/render.ts';

afterEach(() => {
  localStorage.clear();
  for (const theme of THEMES) document.documentElement.classList.remove(`theme--${theme.id}`);
});

test('picking a theme applies it to the whole app and remembers it', async () => {
  await renderWithApp(AppearanceSettings);
  expect(screen.getByRole('radio', { name: /Volt/ }).getAttribute('aria-checked')).toBe('true');

  await userEvent.click(screen.getByRole('radio', { name: /Coral/ }));

  expect(document.documentElement.classList.contains('theme--graphite-coral')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-coral');
  expect(screen.getByRole('radio', { name: /Coral/ }).getAttribute('aria-checked')).toBe('true');
});

test('language remains recognizable and changing it preserves the chosen theme', async () => {
  const view = await renderWithApp(AppearanceSettings);
  await userEvent.click(screen.getByRole('radio', { name: /Coral/ }));
  expect(view.container.querySelector('.language-control__icon')).toBeTruthy();
  await fireEvent.update(screen.getByRole('combobox', { name: 'Язык' }), 'en');
  expect(screen.getByText('Theme')).toBeTruthy();
  await fireEvent.update(screen.getByRole('combobox', { name: 'Language' }), 'fr');
  expect(screen.getByText('Thème')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Langue' })).toBeTruthy();
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Русский', 'English', 'Français']);
  expect(screen.getByRole('radio', { name: /Coral/ }).getAttribute('aria-checked')).toBe('true');
});
