import { expect, test } from 'vitest';
import { avatarInitial } from '../src/lib/shared/utils/avatar-initial';

test('the first letter of the name, upper-cased', () => {
  expect(avatarInitial('анна')).toBe('А');
  expect(avatarInitial('  sasha')).toBe('S');
});

test('a digit counts as a letter', () => {
  expect(avatarInitial('7even')).toBe('7');
});

test('emoji and symbols are skipped when the name has a letter', () => {
  expect(avatarInitial('Сон 💤')).toBe('С');
  expect(avatarInitial('🎧 борис')).toBe('Б');
  expect(avatarInitial('~_~ kit')).toBe('K');
});

test('a name without letters falls back to its first grapheme', () => {
  expect(avatarInitial('💤')).toBe('💤');
  expect(avatarInitial('👨‍👩‍👧 💤')).toBe('👨‍👩‍👧');
});

test('an empty name gives a question mark', () => {
  expect(avatarInitial('')).toBe('?');
  expect(avatarInitial('   ')).toBe('?');
  expect(avatarInitial(null)).toBe('?');
});
