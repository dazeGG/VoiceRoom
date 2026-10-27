/**
 * The reader's default skin tone for reactions.
 *
 * A per-viewer convenience, so `localStorage` is the right home: it never needs
 * to reach the server, and losing it costs one tap to set again. `NEUTRAL_TONE`
 * means "no preference" and leaves every emoji on its toneless base.
 */

const STORAGE_KEY = 'voice-room:reaction-skin-tone';

export const NEUTRAL_TONE = -1;

/** Index into `SKIN_TONES`, or `NEUTRAL_TONE`. */
export type SkinToneIndex = number;

function isToneIndex(value: number, toneCount: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < toneCount;
}

export function loadSkinTone(toneCount: number): SkinToneIndex {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return NEUTRAL_TONE;
    const parsed = Number.parseInt(raw, 10);
    return isToneIndex(parsed, toneCount) ? parsed : NEUTRAL_TONE;
  } catch {
    // Private windows and blocked site data both land here; no preference is a
    // perfectly good answer.
    return NEUTRAL_TONE;
  }
}

export function saveSkinTone(tone: SkinToneIndex, toneCount: number): void {
  try {
    if (isToneIndex(tone, toneCount)) globalThis.localStorage?.setItem(STORAGE_KEY, String(tone));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to fall back to, and nothing important is lost.
  }
}
