'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listReactionEmojis } = require('../src/emoji');
const cjs = require('../src/emoji-skin-tones');

const WAVE = '\u{1F44B}';
const WAVE_MEDIUM = '\u{1F44B}\u{1F3FD}';
const GRINNING = '\u{1F600}';
const HANDSHAKE_MIXED = '\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FF}';

test('collapsing folds every tone variant into a base that stays in the corpus', () => {
  const corpus = listReactionEmojis();
  const collapsed = cjs.listCollapsedReactionEmojis();
  const visible = new Set(collapsed);

  // Order is preserved, so the category ranges in `emoji-groups` still line up.
  assert.deepEqual(collapsed, corpus.filter((emoji) => visible.has(emoji)));
  assert.ok(collapsed.length < corpus.length);
  assert.equal(new Set(collapsed).size, collapsed.length);
  assert.ok(Object.isFrozen(collapsed));

  // Nothing browsable carries a tone: the list shows gestures once, and the
  // colour is a separate choice.
  for (const emoji of collapsed) {
    assert.equal(cjs.skinToneBase(emoji), emoji);
    assert.equal(cjs.isCollapsedSkinToneVariant(emoji), false);
  }
  for (const emoji of corpus) {
    if (visible.has(emoji)) continue;
    assert.ok(cjs.isCollapsedSkinToneVariant(emoji));
    assert.notEqual(cjs.skinToneBase(emoji), emoji);
  }
});

test('every collapsible base offers all five tones, and they are real corpus entries', () => {
  const corpus = new Set(listReactionEmojis());
  const bases = cjs.listCollapsedReactionEmojis().filter((emoji) => cjs.hasSkinToneVariants(emoji));

  assert.ok(bases.length > 0);
  for (const base of bases) {
    const tones = cjs.listSkinToneVariants(base);
    assert.equal(tones.length, cjs.SKIN_TONES.length);
    assert.ok(Object.isFrozen(tones));
    tones.forEach((sequence, index) => {
      assert.ok(corpus.has(sequence));
      assert.equal(cjs.skinToneBase(sequence), base);
      assert.equal(cjs.applySkinTone(base, index), sequence);
      // Tone-uniform only: one swatch cannot mean two different hands.
      const applied = [...sequence].filter((character) => cjs.SKIN_TONES.includes(character));
      assert.ok(applied.length > 0);
      assert.ok(applied.every((tone) => tone === cjs.SKIN_TONES[index]));
    });
  }
});

test('a base without tones, and an out-of-range tone, resolve to the base itself', () => {
  assert.equal(cjs.hasSkinToneVariants(GRINNING), false);
  assert.deepEqual(cjs.listSkinToneVariants(GRINNING), []);
  assert.equal(cjs.applySkinTone(GRINNING, 3), GRINNING);
  assert.equal(cjs.skinToneBase(GRINNING), GRINNING);

  assert.equal(cjs.applySkinTone(WAVE, -1), WAVE);
  assert.equal(cjs.applySkinTone(WAVE, 5), WAVE);
  assert.equal(cjs.applySkinTone(WAVE, 2), WAVE_MEDIUM);
  assert.equal(cjs.skinToneBase(WAVE_MEDIUM), WAVE);
  assert.equal(cjs.isCollapsedSkinToneVariant(WAVE), false);
  assert.equal(cjs.isCollapsedSkinToneVariant(WAVE_MEDIUM), true);
});

test('mixed-tone multi-person sequences are hidden rather than shown as extra colours', () => {
  const visible = new Set(cjs.listCollapsedReactionEmojis());

  // Two people, one modifier each. No single swatch expresses "light hand, dark
  // hand", so this is not offered anywhere; showing it inline instead just read
  // as the same gesture repeated in colours.
  assert.ok(listReactionEmojis().includes(HANDSHAKE_MIXED));
  assert.equal(visible.has(HANDSHAKE_MIXED), false);
  assert.equal(cjs.isCollapsedSkinToneVariant(HANDSHAKE_MIXED), true);
  assert.equal(cjs.hasSkinToneVariants(cjs.skinToneBase(HANDSHAKE_MIXED)), false);
});

test('the ESM view matches the CommonJS one', async () => {
  const esm = await import('../src/emoji-skin-tones.mjs');

  assert.deepEqual(esm.SKIN_TONES, cjs.SKIN_TONES);
  assert.deepEqual(esm.listCollapsedReactionEmojis(), cjs.listCollapsedReactionEmojis());
  assert.deepEqual(esm.listSkinToneVariants(WAVE), cjs.listSkinToneVariants(WAVE));
  assert.equal(esm.applySkinTone(WAVE, 4), cjs.applySkinTone(WAVE, 4));
  assert.equal(esm.skinToneBase(WAVE_MEDIUM), cjs.skinToneBase(WAVE_MEDIUM));
  assert.equal(esm.hasSkinToneVariants(WAVE), cjs.hasSkinToneVariants(WAVE));
  assert.equal(
    esm.isCollapsedSkinToneVariant(WAVE_MEDIUM),
    cjs.isCollapsedSkinToneVariant(WAVE_MEDIUM)
  );
  // Cached, so repeated reads cannot drift.
  assert.strictEqual(cjs.listCollapsedReactionEmojis(), cjs.listCollapsedReactionEmojis());
});
