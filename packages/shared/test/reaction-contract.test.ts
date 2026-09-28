import assert from 'node:assert/strict';
import test from 'node:test';
import * as reactionContract from '../src/reactions.ts';

test('G67-A01 canonical RGI desired-state and bigint summary contracts', async () => {
  const validMutations = [
    { messageId: 'm-1', emoji: '😀', active: true },
    { messageId: 'm-2', emoji: '👩🏽‍💻', active: false },
    { messageId: 'm-3', emoji: '🏳️‍🌈', active: true }
  ];
  for (const fixture of validMutations) {
    assert.deepEqual(reactionContract.normalizeReactionMutation(fixture), fixture);
  }
  for (const emoji of ['A', ':party:', '❤', '👩🏽‍', '😀😀']) {
    assert.equal(reactionContract.normalizeReactionMutation({ messageId: 'm', emoji, active: true }), null);
  }
  assert.equal(reactionContract.normalizeReactionMutation({ messageId: 'm', emoji: '😀', active: 1 }), null);
  assert.equal(reactionContract.normalizeReactionRevision('9223372036854775807'), '9223372036854775807');
  assert.equal(reactionContract.normalizeReactionRevision(-1), null);
  assert.deepEqual(
    reactionContract.normalizeReactionSummary({ emoji: '😀', count: 0, reactedByMe: false, revision: '0' }),
    {
      emoji: '😀',
      count: 0,
      reactedByMe: false,
      revision: '0'
    }
  );
  assert.equal(
    reactionContract.normalizeReactionSummary({ emoji: '😀', count: -1, reactedByMe: false, revision: '1' }),
    null
  );
});

test('G67-A02 reactor envelopes enforce default50/max100, opaque cursors and type parity', async () => {
  assert.deepEqual(reactionContract.normalizeReactorQuery(), { cursor: null, limit: 50 });
  assert.deepEqual(reactionContract.normalizeReactorQuery({ limit: 100, cursor: 'opaque.cursor' }), {
    cursor: 'opaque.cursor',
    limit: 100
  });
  assert.deepEqual(reactionContract.normalizeReactorQuery({ cursor: 'x'.repeat(4096) }), {
    cursor: 'x'.repeat(4096),
    limit: 50
  });
  assert.equal(reactionContract.normalizeReactorQuery({ cursor: 'x'.repeat(4097) }), null);
  assert.equal(reactionContract.normalizeReactorQuery({ limit: 101 }), null);
  assert.equal(reactionContract.normalizeReactorQuery({ limit: 0 }), null);
  const reactors = Array.from({ length: 100 }, (_, index) => ({
    userId: `u-${index}`,
    displayName: `User ${index}`,
    avatarUrl: null
  }));
  assert.deepEqual(reactionContract.normalizeReactorPage({ reactors, nextCursor: 'next' }), {
    reactors,
    nextCursor: 'next'
  });
  assert.equal(reactionContract.normalizeReactorPage({ reactors: [...reactors, reactors[0]], nextCursor: null }), null);
  const mutation: reactionContract.ReactionMutation = { messageId: 'm', emoji: '😀', active: true };
  const summary: reactionContract.ReactionSummary = {
    emoji: '😀',
    count: 1,
    reactedByMe: true,
    revision: '9007199254740993'
  };
  const page: reactionContract.ReactorPage = { reactors: [], nextCursor: null };
  assert.deepEqual(reactionContract.normalizeReactionMutation(mutation), mutation);
  assert.deepEqual(reactionContract.normalizeReactionSummary(summary), summary);
  assert.deepEqual(reactionContract.normalizeReactorPage(page), page);
});
