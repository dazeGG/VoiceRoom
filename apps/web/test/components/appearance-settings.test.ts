import { screen, within } from '@testing-library/vue';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import AppearanceSettings from '@/features/home/components/settings/AppearanceSettings.vue';
import { DOCK_AUTOHIDE_STORAGE_KEY, useAppearanceStore } from '@/shared/appearance/appearance.store';
import { THEMES, THEME_STORAGE_KEY } from '@/shared/theme/theme.store';
import { renderWithApp } from '../helpers/render.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

afterEach(() => {
  localStorage.clear();
  for (const theme of THEMES) document.documentElement.classList.remove(`theme--${theme.id}`);
});

test('picking a theme applies it to the whole app and remembers it', async () => {
  await renderWithApp(AppearanceSettings);
  expect(screen.getByRole('radio', { name: /Volt/, checked: true })).toBeTruthy();

  await userEvent.click(screen.getByRole('radio', { name: /Coral/ }));

  expect(document.documentElement.classList.contains('theme--graphite-coral')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-coral');
  expect(screen.getByRole('radio', { name: /Coral/, checked: true })).toBeTruthy();
});

test('the call dock starts pinned and a new store restores the choice made with the switch', async () => {
  await renderWithApp(AppearanceSettings);
  const name = 'Скрывать панель звонка';
  const toggle = screen.getByRole('switch', { name, checked: false });
  expect(screen.getByText('Панель управления появляется, когда вы наводите курсор на звонок')).toBeTruthy();

  await userEvent.click(toggle);
  expect(screen.getByRole('switch', { name, checked: true })).toBe(toggle);
  expect(localStorage.getItem(DOCK_AUTOHIDE_STORAGE_KEY)).toBe('true');
  const fresh = useAppearanceStore(createPinia());
  fresh.initAppearance();
  expect(fresh.dockAutoHide).toBe(true);

  await userEvent.click(toggle);
  expect(screen.getByRole('switch', { name, checked: false })).toBe(toggle);
  fresh.initAppearance();
  expect(fresh.dockAutoHide).toBe(false);
});

test('language remains recognizable and changing it preserves the chosen theme', async () => {
  const view = await renderWithApp(AppearanceSettings);
  await userEvent.click(screen.getByRole('radio', { name: /Coral/ }));
  expect(view.container.querySelector('.language-control__icon')).toBeTruthy();
  await userEvent.click(screen.getByRole('combobox', { name: 'Язык' }));
  await userEvent.click(await screen.findByRole('option', { name: 'English' }));
  expect(screen.getByText('Theme')).toBeTruthy();
  await userEvent.click(screen.getByRole('combobox', { name: 'Language' }));
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Русский', 'English', 'Français']);
  await userEvent.click(screen.getByRole('option', { name: 'Français' }));
  expect(screen.getByText('Thème')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Langue' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: /Coral/, checked: true })).toBeTruthy();
});

test('arrow keys select themes and Tab leaves the radio group', async () => {
  await renderWithApp(AppearanceSettings);
  screen.getByRole('radio', { name: /Volt/ }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Ice/ }));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite-ice');
  await userEvent.tab();
  expect(screen.getByRole('radiogroup').contains(document.activeElement)).toBe(false);
});

test('two mounted theme selectors each retain the selected choice', async () => {
  const Host = defineComponent({ setup: () => () => [h(AppearanceSettings), h(AppearanceSettings)] });
  await renderWithApp(Host);
  const [first, second] = screen.getAllByRole('radiogroup');
  if (!first || !second) throw new Error('Both theme groups must render');
  await userEvent.click(within(second).getByRole('radio', { name: /Coral/ }));
  expect(within(first).getByRole('radio', { name: /Coral/, checked: true })).toBeTruthy();
  expect(within(second).getByRole('radio', { name: /Coral/, checked: true })).toBeTruthy();
});
