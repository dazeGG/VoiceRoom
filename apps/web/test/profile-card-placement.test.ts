import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';

const person = {
  userId: 'bob',
  name: 'Боб',
  login: 'bob',
  avatarUrl: null,
  avatarColorKey: 'green',
  avatarAccent: null,
  presence: 'online' as const
};

function profileCard() {
  return useProfileCardUiStore();
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => profileCard().closeProfileCard(false));

test('the card opens to the right of the avatar', () => {
  vi.stubGlobal('innerWidth', 1280);
  const { openProfileCardFor, profileCardUi } = profileCard();
  openProfileCardFor(person, { rect: { left: 300, right: 336, top: 200 } });
  expect(profileCardUi.x).toBe(346);
  expect(profileCardUi.y).toBe(184);
});

test('near the right edge it opens to the left of the avatar instead', () => {
  vi.stubGlobal('innerWidth', 1280);
  const { openProfileCardFor, profileCardUi } = profileCard();
  openProfileCardFor(person, { rect: { left: 1200, right: 1236, top: 200 } });
  expect(profileCardUi.x).toBe(1200 - 10 - 300);
});
