import { beforeEach, expect, test } from 'vitest';
import Topbar from '@/shared/components/Topbar.vue';
import { renderWithApp } from '../helpers/render';

beforeEach(() => localStorage.clear());

test('a sign-in header keeps its action separate from language selection', async () => {
  const view = await renderWithApp(Topbar, { slots: { default: '<a href="/login">Войти</a>' } });
  expect(view.getByRole('banner').contains(view.getByRole('link', { name: 'Войти' }))).toBe(true);
  expect(view.queryByRole('combobox')).toBeNull();
});

test('room headers can retain a compact language control with recognizable icon and autonyms', async () => {
  const view = await renderWithApp(Topbar, { props: { showLanguage: true } });
  expect(view.getByRole('combobox', { name: 'Язык' })).toBeTruthy();
  expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual(['Русский', 'English', 'Français']);
  expect(view.container.querySelector('.language-control__icon')?.getAttribute('aria-hidden')).toBe('true');
});
