import { expect, test } from 'vitest';
import { displayNameOf } from '../src/shared/utils/display-name.ts';

test('the display name wins, trimmed; the login stands in when it is empty or missing', () => {
  expect(displayNameOf({ displayName: '  Анна ', login: 'anna' })).toBe('Анна');
  expect(displayNameOf({ displayName: '   ', login: 'anna' })).toBe('anna');
  expect(displayNameOf({ displayName: null, login: 'anna' })).toBe('anna');
  expect(displayNameOf({ login: 'anna' })).toBe('anna');
});
