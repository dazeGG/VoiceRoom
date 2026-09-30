// Every failure code the API can send has a text on the web.

import { expect, test } from 'vitest';
import { ERROR_CODES } from '@voice-room/shared/contracts/errors';
import { ERROR_TEXTS, errorText } from '../../src/lib/api/error-texts.ts';

test('the catalogue and the texts cover exactly the same codes', () => {
  expect(Object.keys(ERROR_TEXTS).sort()).toEqual([...ERROR_CODES].sort());
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  for (const code of ERROR_CODES) expect(ERROR_TEXTS[code].trim()).not.toBe('');
});

test('an unknown code, or a name inherited from Object, has no text', () => {
  expect(errorText('room_banned')).toBe('Вы заблокированы в этой комнате');
  expect(errorText('added_in_a_later_server')).toBeNull();
  expect(errorText('toString')).toBeNull();
});
