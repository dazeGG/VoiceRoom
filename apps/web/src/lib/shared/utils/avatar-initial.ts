const LETTER_OR_DIGIT = /^[\p{L}\p{N}]/u;

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/**
 * The avatar letter for a name: the first grapheme that is a letter or digit,
 * upper-cased. Emoji and symbols are skipped ("Сон 💤" → "С"); a name without
 * any letter falls back to its first grapheme ("💤"), and an empty one to "?".
 */
export function avatarInitial(name: string | null | undefined): string {
  const parts = graphemes((name ?? '').trim());
  if (parts.length === 0) return '?';
  const letter = parts.find((part) => LETTER_OR_DIGIT.test(part));
  return letter ? letter.toUpperCase() : parts[0];
}
