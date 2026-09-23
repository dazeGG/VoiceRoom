import test from 'node:test';
import assert from 'node:assert/strict';

import { listReactionEmojis } from '../src/emoji.ts';
import * as emojiGroups from '../src/emoji-groups.ts';

test('reaction emoji groups are an immutable ordered partition of the frozen corpus', async () => {
  const groups = emojiGroups.listReactionEmojiGroups();
  const corpus = listReactionEmojis();

  assert.deepEqual(groups.map((group) => group.key), [
    'smileys',
    'people',
    'nature',
    'food',
    'travel',
    'activities',
    'objects',
    'symbols',
    'flags'
  ]);
  assert.deepEqual(groups.flatMap((group) => group.emojis), corpus);
  assert.equal(new Set(groups.flatMap((group) => group.emojis)).size, corpus.length);
  assert.ok(Object.isFrozen(groups));
  assert.ok(groups.every((group) => Object.isFrozen(group) && Object.isFrozen(group.emojis)));
  assert.strictEqual(emojiGroups.listReactionEmojiGroups(), groups);

  for (const group of groups) {
    assert.equal(emojiGroups.reactionEmojiGroupKey(group.emojis[0]), group.key);
  }
  assert.equal(emojiGroups.reactionEmojiGroupKey('not-an-emoji'), '');
});
