import { test, vi } from 'vitest';
import assert from 'node:assert/strict';


async function loadInsert() {
  vi.resetModules();
  return import('../src/lib/shared/chat/composer-insert.ts');
}

test('an emoji lands at the caret, replaces a selection, and leaves the caret after itself', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.deepEqual(insertIntoDraft('привет мир', '👋', { start: 6, end: 6 }), { text: 'привет👋 мир', caret: 8 });
  assert.deepEqual(insertIntoDraft('привет мир', '🌍', { start: 7, end: 10 }), { text: 'привет 🌍', caret: 9 });
  assert.deepEqual(insertIntoDraft('', '😂', { start: 0, end: 0 }), { text: '😂', caret: 2 });
});

test('a field that never had a caret gets the emoji at the end, and out-of-range carets are clamped', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: null, end: undefined }), { text: 'ок👍', caret: 4 });
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: 99, end: 99 }), { text: 'ок👍', caret: 4 });
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: 2, end: 0 }), { text: 'ок👍', caret: 4 }, 'an end before the start is an empty selection');
});

test('an emoji that would overflow the field is not inserted', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.equal(insertIntoDraft('a'.repeat(499), '👍', { start: 499, end: 499 }, 500), null);
  assert.deepEqual(insertIntoDraft('a'.repeat(498), '👍', { start: 498, end: 498 }, 500)?.caret, 500);
});

