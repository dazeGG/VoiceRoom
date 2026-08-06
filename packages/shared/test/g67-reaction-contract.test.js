'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const cjs = require('../src/reactions');

test('G67-A01 canonical RGI desired-state and bigint summary contracts match CJS and ESM', async () => {
  const esm = await import('../src/reactions.mjs');
  const validMutations = [
    { messageId: 'm-1', emoji: '😀', active: true },
    { messageId: 'm-2', emoji: '👩🏽‍💻', active: false },
    { messageId: 'm-3', emoji: '🏳️‍🌈', active: true }
  ];
  for (const fixture of validMutations) {
    assert.deepEqual(cjs.normalizeReactionMutation(fixture), fixture);
    assert.deepEqual(esm.normalizeReactionMutation(fixture), fixture);
  }
  for (const emoji of ['A', ':party:', '❤', '👩🏽‍', '😀😀']) {
    assert.equal(cjs.normalizeReactionMutation({ messageId: 'm', emoji, active: true }), null);
  }
  assert.equal(cjs.normalizeReactionMutation({ messageId: 'm', emoji: '😀', active: 1 }), null);
  assert.equal(cjs.normalizeReactionRevision('9223372036854775807'), '9223372036854775807');
  assert.equal(cjs.normalizeReactionRevision(-1), null);
  assert.deepEqual(cjs.normalizeReactionSummary({ emoji: '😀', count: 0, reactedByMe: false, revision: '0' }), {
    emoji: '😀', count: 0, reactedByMe: false, revision: '0'
  });
  assert.equal(cjs.normalizeReactionSummary({ emoji: '😀', count: -1, reactedByMe: false, revision: '1' }), null);
});

test('G67-A02 reactor envelopes enforce default50/max100, opaque cursors and type parity', async () => {
  assert.deepEqual(cjs.normalizeReactorQuery(), { cursor: null, limit: 50 });
  assert.deepEqual(cjs.normalizeReactorQuery({ limit: 100, cursor: 'opaque.cursor' }), { cursor: 'opaque.cursor', limit: 100 });
  assert.deepEqual(cjs.normalizeReactorQuery({ cursor: 'x'.repeat(4096) }), { cursor: 'x'.repeat(4096), limit: 50 });
  assert.equal(cjs.normalizeReactorQuery({ cursor: 'x'.repeat(4097) }), null);
  assert.equal(cjs.normalizeReactorQuery({ limit: 101 }), null);
  assert.equal(cjs.normalizeReactorQuery({ limit: 0 }), null);
  const reactors = Array.from({ length: 100 }, (_, index) => ({
    userId: `u-${index}`, displayName: `User ${index}`, avatarUrl: null
  }));
  assert.deepEqual(cjs.normalizeReactorPage({ reactors, nextCursor: 'next' }), { reactors, nextCursor: 'next' });
  assert.equal(cjs.normalizeReactorPage({ reactors: [...reactors, reactors[0]], nextCursor: null }), null);
  const declarations = require('node:fs').readFileSync(require.resolve('../src/reactions.d.ts'), 'utf8');
  assert.match(declarations, /active: boolean/);
  assert.match(declarations, /revision: string/);
  assert.match(declarations, /ReactorPage/);
});
