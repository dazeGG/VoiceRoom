import { screen } from '@testing-library/vue';
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
