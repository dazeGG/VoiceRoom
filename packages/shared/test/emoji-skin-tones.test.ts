import test from 'node:test';
import assert from 'node:assert/strict';

import { listReactionEmojis } from '../src/emoji.ts';
import * as skinTones from '../src/emoji-skin-tones.ts';

const WAVE = '\u{1F44B}';
const WAVE_MEDIUM = '\u{1F44B}\u{1F3FD}';
const GRINNING = '\u{1F600}';
const HANDSHAKE_MIXED = '\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FF}';
const HANDSHAKE_TONELESS = '\u{1FAF1}\u{200D}\u{1FAF2}';

const carriesTone = (emoji: string) => Array.from(emoji).some((character) => skinTones.SKIN_TONES.includes(character));
const withoutTones = (emoji: string) =>
  Array.from(emoji)
    .filter((character) => !skinTones.SKIN_TONES.includes(character))
    .join('');

test('collapsing folds every tone variant into a base that stays in the corpus', () => {
  const corpus = listReactionEmojis();
  const collapsed = skinTones.listCollapsedReactionEmojis();
  const visible = new Set(collapsed);

  // Order is preserved, so the category ranges in `emoji-groups` still line up.
  assert.deepEqual(
    collapsed,
    corpus.filter((emoji) => visible.has(emoji))
  );
  assert.ok(collapsed.length < corpus.length);
  assert.equal(new Set(collapsed).size, collapsed.length);
  assert.ok(Object.isFrozen(collapsed));

  // Nothing browsable carries a tone: the list shows gestures once, and the
  // colour is a separate choice.
  for (const emoji of collapsed) assert.equal(carriesTone(emoji), false);
  for (const emoji of corpus) {
    if (visible.has(emoji)) continue;
    assert.ok(carriesTone(emoji));
  }
});

test('every collapsible base offers all five tones, and they are real corpus entries', () => {
  const corpus = new Set(listReactionEmojis());
  const bases = skinTones.listCollapsedReactionEmojis().filter((emoji) => skinTones.hasSkinToneVariants(emoji));

  assert.ok(bases.length > 0);
  for (const base of bases) {
    const tones = skinTones.listSkinToneVariants(base);
    assert.equal(tones.length, skinTones.SKIN_TONES.length);
    assert.ok(Object.isFrozen(tones));
    tones.forEach((sequence, index) => {
      assert.ok(corpus.has(sequence));
      assert.equal(withoutTones(sequence), base);
      assert.equal(skinTones.applySkinTone(base, index), sequence);
      // Tone-uniform only: one swatch cannot mean two different hands.
      const applied = Array.from(sequence).filter((character) => skinTones.SKIN_TONES.includes(character));
      assert.ok(applied.length > 0);
      assert.ok(applied.every((tone) => tone === skinTones.SKIN_TONES[index]));
    });
  }
});

test('a base without tones, and an out-of-range tone, resolve to the base itself', () => {
  const visible = new Set(skinTones.listCollapsedReactionEmojis());
  assert.equal(skinTones.hasSkinToneVariants(GRINNING), false);
  assert.deepEqual(skinTones.listSkinToneVariants(GRINNING), []);
  assert.equal(skinTones.applySkinTone(GRINNING, 3), GRINNING);
  assert.ok(visible.has(GRINNING));

  assert.equal(skinTones.applySkinTone(WAVE, -1), WAVE);
  assert.equal(skinTones.applySkinTone(WAVE, 5), WAVE);
  assert.equal(skinTones.applySkinTone(WAVE, 2), WAVE_MEDIUM);
  assert.ok(skinTones.listSkinToneVariants(WAVE).includes(WAVE_MEDIUM));
  assert.ok(visible.has(WAVE));
  assert.equal(visible.has(WAVE_MEDIUM), false);
});

test('mixed-tone multi-person sequences are hidden rather than shown as extra colours', () => {
  const visible = new Set(skinTones.listCollapsedReactionEmojis());

  // Two people, one modifier each. No single swatch expresses "light hand, dark
  // hand", so this is not offered anywhere; showing it inline instead just read
  // as the same gesture repeated in colours.
  assert.ok(listReactionEmojis().includes(HANDSHAKE_MIXED));
  assert.equal(visible.has(HANDSHAKE_MIXED), false);
  assert.equal(withoutTones(HANDSHAKE_MIXED), HANDSHAKE_TONELESS);
  assert.equal(skinTones.hasSkinToneVariants(HANDSHAKE_TONELESS), false);
});

test('the collapsed list is built once, so repeated reads cannot drift', () => {
  assert.strictEqual(skinTones.listCollapsedReactionEmojis(), skinTones.listCollapsedReactionEmojis());
});
