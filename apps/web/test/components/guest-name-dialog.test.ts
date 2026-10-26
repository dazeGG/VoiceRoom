// The name a guest gives before entering a room: under the button, one line
// says which terms they accept and links the personal data policy. It informs;
// a call needs no consent, so there is nothing to tick.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import RoomOverlays from '../../src/lib/features/room/components/RoomOverlays.svelte';
import { guestNameUi } from '../../src/lib/features/room/guest-name-ui.svelte';

afterEach(() => {
  cleanup();
  guestNameUi.open = false;
});

test('the guest name dialog links the terms and the personal data policy, with nothing to tick', () => {
  guestNameUi.open = true;
  render(RoomOverlays);
  const dialog = screen.getByRole('dialog', { name: 'Как вас зовут?' });
  const terms = within(dialog).getByRole('link', { name: 'Пользовательское соглашение' });
  const privacy = within(dialog).getByRole('link', { name: 'Политике обработки персональных данных' });
  expect(terms.getAttribute('href')).toMatch(/\/terms$/);
  expect(privacy.getAttribute('href')).toMatch(/\/privacy$/);
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Войти в комнату' })).toBeTruthy();
});
