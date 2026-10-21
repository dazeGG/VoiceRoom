// A guest's lasting browser id is a UUID; anything else is no id at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuestId } from '../src/validation.ts';

test('a guest id is a UUID, trimmed and lower-cased', () => {
  assert.equal(normalizeGuestId(' 6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B '), '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
});

test('anything that is not a UUID is no guest id', () => {
  for (const value of [undefined, null, 42, '', 'guest', '6f1c2a3b4d5e4f608a7b9c0d1e2f3a4b', 'g'.repeat(36)]) {
    assert.equal(normalizeGuestId(value), '', String(value));
  }
});
