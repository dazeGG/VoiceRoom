'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listReactionEmojis } = require('../src/emoji');
const cjs = require('../src/emoji-groups');

test('reaction emoji groups are an immutable ordered partition of the frozen corpus', async () => {
  const esm = await import('../src/emoji-groups.mjs');
  const groups = cjs.listReactionEmojiGroups();
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
  assert.strictEqual(cjs.listReactionEmojiGroups(), groups);
  assert.deepEqual(esm.listReactionEmojiGroups(), groups);

  for (const group of groups) {
    assert.equal(cjs.reactionEmojiGroupKey(group.emojis[0]), group.key);
    assert.equal(esm.reactionEmojiGroupKey(group.emojis.at(-1)), group.key);
  }
  assert.equal(cjs.reactionEmojiGroupKey('not-an-emoji'), '');
});
