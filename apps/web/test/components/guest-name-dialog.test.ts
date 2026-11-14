// The name a guest gives before entering a room: under the button, one line
// says which terms they accept and links the personal data policy. It informs;
// a call needs no consent, so there is nothing to tick.

import { fireEvent, screen, within } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { nextTick } from 'vue';
import { useLocaleStore } from '@/shared/i18n';
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
  expect(within(dialog).getByRole('button', { name: 'Войти', exact: true })).toBeTruthy();
  const rawName = 'Алиса {p0} Élodie';
  await fireEvent.update(within(dialog).getByRole('textbox'), rawName);
  for (const [locale, title, termsName, privacyName, action] of [
    ['en', 'What is your name?', 'User Agreement', 'Personal data processing policy', 'Join'],
    [
      'fr',
      'Quel est ton nom ?',
      "Contrat d'utilisation",
      'Politique de traitement des données personnelles',
      'Rejoindre'
    ]
  ] as const) {
    await useLocaleStore(view.pinia).select(locale);
    await nextTick();
    expect(screen.getByRole('dialog', { name: title })).toBe(dialog);
    expect(within(dialog).getByRole('link', { name: termsName }).getAttribute('href')).toMatch(/\/terms$/);
    expect(within(dialog).getByRole('link', { name: privacyName }).getAttribute('href')).toMatch(/\/privacy$/);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).getByRole('button', { name: action, exact: true })).toBeTruthy();
    expect(within(dialog).getByDisplayValue(rawName)).toBeTruthy();
    expect(useGuestNameUiStore(view.pinia).inputValue).toBe(rawName);
  }
});
