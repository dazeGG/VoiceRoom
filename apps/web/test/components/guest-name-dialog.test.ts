// The name a guest gives before entering a room: under the button, one line
// says which terms they accept and links the personal data policy. It informs;
// a call needs no consent, so there is nothing to tick.

import { screen, within } from '@testing-library/vue';
import { expect, test } from 'vitest';
import RoomOverlays from '@/features/room/components/RoomOverlays.vue';
import { useGuestNameUiStore } from '@/features/room/guest-name-ui.store';
import { renderWithApp } from '../helpers/render';

test('the guest name dialog links the terms and the personal data policy, with nothing to tick', async () => {
  const view = await renderWithApp(RoomOverlays);
  useGuestNameUiStore(view.pinia).open = true;
  const dialog = await screen.findByRole('dialog', { name: 'Как вас зовут?' });
  const terms = within(dialog).getByRole('link', { name: 'Пользовательское соглашение' });
  const privacy = within(dialog).getByRole('link', { name: 'Политике обработки персональных данных' });
  expect(terms.getAttribute('href')).toMatch(/\/terms$/);
  expect(privacy.getAttribute('href')).toMatch(/\/privacy$/);
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Войти в комнату' })).toBeTruthy();
});
