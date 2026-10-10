import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import AppearanceSettings from '../../src/lib/features/home/components/settings/AppearanceSettings.svelte';
import { setTheme, THEME_STORAGE_KEY } from '../../src/lib/shared/theme/theme.svelte';

afterEach(() => {
  cleanup();
  setTheme('graphite-volt');
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test('picking a theme applies it to the whole app and remembers it', async () => {
  render(AppearanceSettings);
  expect(screen.getByRole('radio', { name: /Volt/ }).getAttribute('aria-checked')).toBe('true');

  await userEvent.click(screen.getByRole('radio', { name: /Coral/ }));

  expect(document.documentElement.dataset.theme).toBe('graphite-coral');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-coral');
  expect(screen.getByRole('radio', { name: /Coral/ }).getAttribute('aria-checked')).toBe('true');
});
