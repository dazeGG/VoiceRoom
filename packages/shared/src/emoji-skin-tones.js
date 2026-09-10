'use strict';

// Skin-tone layer over the frozen reaction corpus.
//
// The corpus lists every tone variant as its own entry, so 1705 of its 3944
// entries are tone variants of something already in the list. Browsing that is
// the picker showing the same gesture six times in a row, so the UI collapses
// each family behind its toneless base and offers the tones as a choice. The
// wire format is unaffected: `PUT .../reactions` still carries the full
// sequence, and per the 2.6 Unicode policy each tone stays a distinct key.
//
// Derived from the corpus rather than shipped as a table, for the same reason
// `emoji-groups.js` derives its ranges: `emoji.js` is content-hash asserted by
// G07 and must not grow a second copy of itself.

const { listReactionEmojis } = require('./emoji.js');

// U+1F3FB..U+1F3FF. Unicode's "Component" group is rejected by the corpus
// policy, so these never appear in the corpus on their own.
const SKIN_TONES = Object.freeze(['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']);

const TONE_SET = new Set(SKIN_TONES);

function toneless(sequence) {
  let base = '';
  for (const character of sequence) {
    if (!TONE_SET.has(character)) base += character;
  }
  return base;
}

function tonesIn(sequence) {
  const tones = [];
  for (const character of sequence) {
    if (TONE_SET.has(character)) tones.push(character);
  }
  return tones;
}

function build() {
  const corpus = listReactionEmojis();
  const present = new Set(corpus);

  /** @type {Map<string, Array<{ sequence: string, tones: string[] }>>} */
  const families = new Map();
  for (const sequence of corpus) {
    const tones = tonesIn(sequence);
    if (tones.length === 0) continue;
    const base = toneless(sequence);
    const family = families.get(base);
    if (family) family.push({ sequence, tones });
    else families.set(base, [{ sequence, tones }]);
  }

  const byBase = new Map();
  // Nothing carrying a tone modifier is ever browsed directly. Leaving some of
  // them inline — the mixed-tone spellings that no single swatch can express —
  // read as the picker showing the same gesture in several colours for no
  // apparent reason, so they are reached through a base's swatches or not at
  // all.
  const collapsed = new Set(corpus.filter((emoji) => tonesIn(emoji).length > 0));

  for (const [base, variants] of families) {
    // A base the corpus does not carry itself has nothing to collapse behind:
    // these are the mixed-tone multi-person sequences (two people, two
    // modifiers), whose neutral form is spelled as a different emoji entirely.
    // They stay inline so nothing becomes unreachable by browsing.
    if (!present.has(base)) continue;

    // Only tone-uniform variants are offered as a choice — one swatch cannot
    // express "light hand, dark hand". Every collapsible family in the pinned
    // corpus has all five; the test asserts that, so a corpus regeneration that
    // broke it would fail rather than silently drop a swatch.
    const uniform = new Map();
    for (const { sequence, tones } of variants) {
      const [first] = tones;
      if (tones.every((tone) => tone === first)) uniform.set(first, sequence);
    }
    if (uniform.size !== SKIN_TONES.length) continue;

    const tones = Object.freeze(SKIN_TONES.map((tone) => uniform.get(tone)));
    byBase.set(base, Object.freeze({ base, tones }));
  }

  const visible = Object.freeze(corpus.filter((emoji) => !collapsed.has(emoji)));
  return { byBase, collapsed, visible };
}

let cached = null;

function data() {
  cached = cached || build();
  return cached;
}

/** Whether the picker hides this sequence behind a base. */
function isCollapsedSkinToneVariant(emoji) {
  return data().collapsed.has(emoji);
}

/**
 * The five tone variants of a base, lightest first, or an empty array when the
 * base has no tones or is not collapsible.
 */
function listSkinToneVariants(base) {
  return data().byBase.get(base)?.tones ?? Object.freeze([]);
}

function hasSkinToneVariants(base) {
  return data().byBase.has(base);
}

/**
 * Resolve a base to one tone. `toneIndex` is 0-4; anything else — including the
 * "no preference" case — yields the neutral base unchanged.
 */
function applySkinTone(base, toneIndex) {
  const variants = data().byBase.get(base);
  if (!variants) return base;
  return variants.tones[toneIndex] ?? base;
}

/** The toneless base of any sequence; returns the input when it carries none. */
function skinToneBase(emoji) {
  return tonesIn(emoji).length === 0 ? emoji : toneless(emoji);
}

/** Corpus order, with every collapsible tone variant folded into its base. */
function listCollapsedReactionEmojis() {
  return data().visible;
}

module.exports = {
  SKIN_TONES,
  applySkinTone,
  hasSkinToneVariants,
  isCollapsedSkinToneVariant,
  listCollapsedReactionEmojis,
  listSkinToneVariants,
  skinToneBase
};
