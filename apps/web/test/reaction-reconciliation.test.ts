import assert from 'node:assert/strict';
import { test } from 'vitest';

test('G70 authoritative empty snapshot removes settled reactions and preserves pending optimistic entries', async () => {
  const { replaceReactionSnapshot } = await import('../src/lib/shared/chat/reaction-reconciliation.ts');
  const current = [
    { emoji: '👍', count: 1, reactedByMe: false, revision: '2', pending: false, error: '' },
    { emoji: '🔥', count: 1, reactedByMe: true, revision: '3', pending: true, error: '' }
  ];
  assert.deepEqual(replaceReactionSnapshot(current, []), [current[1]]);
  assert.deepEqual(replaceReactionSnapshot(current, [{ emoji: '👍', count: 0, reactedByMe: false, revision: '4' }]), [
    current[1]
  ]);
});
