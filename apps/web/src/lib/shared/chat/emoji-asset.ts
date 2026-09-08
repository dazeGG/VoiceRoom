/**
 * Where a reaction's artwork lives.
 *
 * Reactions are drawn from SVG rather than left to the platform font, because
 * the platform font is not a renderer we control: Windows ships no flag glyphs,
 * so `🇷🇺` comes out as the letters "RU" there, and every OS draws the rest of
 * the set differently. The files are generated into `static/emoji/` from the
 * pinned OpenMoji package — see `scripts/build-emoji-assets.mjs`.
 */

/** Every code point of the sequence, upper-case hex, joined by `-`. */
export function emojiAssetName(emoji: string): string {
  return [...emoji]
    .map((character) => character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '')
    .join('-');
}

export function emojiAssetUrl(emoji: string): string {
  return `/emoji/${emojiAssetName(emoji)}.svg`;
}
