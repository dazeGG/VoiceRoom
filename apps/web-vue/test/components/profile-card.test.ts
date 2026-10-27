// The profile card takes the colour the server derived for the avatar (its
// accent) rather than recomputing one, falls back to the palette colour, and
// offers actions that fit the relationship.

import { screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { ProfileCard } from '@/shared/components/profile-card';
import type { ProfileCardPerson } from '@/shared/components/profile-card/types';
import { getAvatarColor } from '@/visual/tokens';
import { renderWithApp } from '../helpers/render.ts';

function person(extra: Partial<ProfileCardPerson> = {}): ProfileCardPerson {
  return {
    userId: 'bob',
    name: 'Боб',
    login: 'bob',
    avatarUrl: '/api/avatars/bob.webp',
    avatarColorKey: 'green',
    avatarAccent: '#4a7d5c',
    presence: 'online',
    ...extra
  };
}

const accent = (container: Element) =>
  container.querySelector<HTMLElement>('[data-profile-card]')?.style.getPropertyValue('--profile-accent');

test('the card is tinted with the server accent of the avatar', async () => {
  const { container } = await renderWithApp(ProfileCard, { props: { person: person(), relationship: 'friend' } });
  expect(accent(container)).toBe('#4a7d5c');
});

test('without an accent the palette colour of the avatar is used', async () => {
  const { container } = await renderWithApp(ProfileCard, {
    props: { person: person({ avatarAccent: null }), relationship: 'none' }
  });
  expect(accent(container)).toBe(getAvatarColor('green').background);
});

test('your own card and a guest card offer no friend actions', async () => {
  const own = await renderWithApp(ProfileCard, { props: { person: person(), relationship: 'self' } });
  expect(screen.queryAllByRole('button')).toEqual([]);
  own.unmount();
  await renderWithApp(ProfileCard, { props: { person: person({ userId: null }), relationship: 'unavailable' } });
  expect(screen.queryAllByRole('button')).toEqual([]);
});
