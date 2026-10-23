import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { normalizePeerId } from '@voice-room/shared/validation';
import { newId } from '../src/lib/shared/new-id.ts';

test('an id is a UUID where the browser can make one', () => {
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
  assert.equal(newId(), '11111111-2222-4333-8444-555555555555');
});

test('outside a secure context an id is still made, distinct each time and valid as a peer id', () => {
  vi.stubGlobal('crypto', {});
  const first = newId();
  const second = newId();
  assert.notEqual(first, second);
  assert.equal(normalizePeerId(first), first);
});

test('an id is made even where the browser has no crypto at all', () => {
  vi.stubGlobal('crypto', undefined);
  assert.ok(newId());
});
