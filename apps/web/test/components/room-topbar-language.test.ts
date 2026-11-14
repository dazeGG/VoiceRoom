import { afterEach, beforeEach, expect, test } from 'vitest';
import { nextTick } from 'vue';
import userEvent from '@testing-library/user-event';
import RoomTopbar from '@/features/room/components/RoomTopbar.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { participant } from '../fixtures/participant';
import { authUser } from '../fixtures/users';
import { renderWithApp } from '../helpers/render';

beforeEach(() => localStorage.clear());
afterEach(() => {
  roomClientState.self = null;
  localStorage.clear();
  document.documentElement.lang = 'ru';
});

test('unresolved and authenticated sessions have no language picker, even before room identity arrives', async () => {
  const view = await renderWithApp(RoomTopbar);
  expect(view.queryByRole('combobox')).toBeNull();

  useSessionStore(view.pinia).setUser(authUser());
  await nextTick();
  expect(view.queryByRole('combobox')).toBeNull();

  roomClientState.self = participant({ id: 'guest-peer', name: 'Гость', accountUserId: '' });
  await nextTick();
  expect(view.queryByRole('combobox')).toBeNull();
});

test('guests can change language, while sign-in hides the picker and sign-out restores the saved choice', async () => {
  const view = await renderWithApp(RoomTopbar);
  const session = useSessionStore(view.pinia);
  session.setUser(null);
  await nextTick();

  const picker = view.getByRole('combobox', { name: 'Язык' });
  expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual(['Русский', 'English', 'Français']);
  expect(view.container.querySelector('.language-control__icon')).toBeTruthy();
  await userEvent.selectOptions(picker, 'fr');
  expect(localStorage.getItem('voiceroom.locale')).toBe('fr');

  session.setUser(authUser());
  await nextTick();
  expect(view.queryByRole('combobox')).toBeNull();

  session.clearSession();
  await nextTick();
  expect(view.getByRole('combobox', { name: 'Langue' })).toHaveProperty('value', 'fr');
});
