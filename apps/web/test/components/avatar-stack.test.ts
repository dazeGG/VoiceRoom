import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { AvatarStack } from '@voice-room/ui/components';

const items = ['Аня', 'Олег', 'Мира', 'Катя', 'Тимур', 'Даша', 'Борис'].map((label) => ({
  id: label,
  label,
  initials: label.slice(0, 1),
  background: 'var(--vr-surface-3)'
}));

test('the stack announces the visible people and the size of the overflow as one image', () => {
  render(AvatarStack, { props: { items } });

  expect(screen.getAllByRole('img')).toEqual([screen.getByRole('img', { name: 'Аня, Олег, Мира и ещё 4' })]);
  expect(screen.getByText('+4')).toBeTruthy();
});

test('an unlimited stack announces all names and preserves the caller label', () => {
  render(AvatarStack, { props: { items: items.slice(0, 2), maxAvatars: null, ariaLabel: 'В комнате' } });

  expect(screen.getByRole('img', { name: 'В комнате: Аня, Олег' })).toBeTruthy();
  expect(screen.queryByText(/\+\d/)).toBeNull();
});

test('an empty stack renders its fallback without an image', () => {
  render(AvatarStack, { props: { items: [] }, slots: { empty: 'Пока никого нет' } });

  expect(screen.getByText('Пока никого нет')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
