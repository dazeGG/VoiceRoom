/**
 * What this app offers as a reaction.
 *
 * The Unicode corpus reaches further than the artwork does: Twemoji has no file
 * for 303 of the newest additions. Offering those anyway would drop them back
 * onto the platform font, so they would look foreign beside everything else and
 * — for flags on Windows — come out as letters. So the offered set is locked to
 * the artwork: `emoji-coverage.json` is regenerated alongside the files by
 * `scripts/build-emoji-assets.mjs`.
 *
 * Skin tones are folded away by the shared layer; this module only narrows what
 * survives to what can actually be drawn.
 */

import { listReactionEmojiGroups } from '@voice-room/shared/emoji-groups';
import {
  SKIN_TONES,
  applySkinTone,
  hasSkinToneVariants,
  listCollapsedReactionEmojis,
  listSkinToneVariants
} from '@voice-room/shared/emoji-skin-tones';

import coverage from './emoji-coverage.json';

export interface EmojiCategory {
  key: string;
  label: string;
  icon: string;
  emojis: string[];
}

const OFFERED = new Set<string>(coverage.emojis);

/** Whether this app draws, and therefore offers, this exact sequence. */
export function isOfferedEmoji(emoji: string): boolean {
  return OFFERED.has(emoji);
}

/** Every emoji the picker may browse, in corpus order, tones already folded. */
export const BROWSABLE_EMOJIS: readonly string[] = Object.freeze(
  listCollapsedReactionEmojis().filter(isOfferedEmoji)
);

const BROWSABLE_SET = new Set(BROWSABLE_EMOJIS);

/**
 * The tones offered for a base: `[neutral, ...five tones]`, or an empty array
 * when the base has none or its artwork is incomplete. A partial strip would
 * put a gap where a colour should be, so it is all six or nothing.
 */
export function skinToneChoices(base: string): readonly string[] {
  if (!hasSkinToneVariants(base)) return [];
  const tones = listSkinToneVariants(base);
  if (tones.length !== SKIN_TONES.length || !tones.every(isOfferedEmoji)) return [];
  return [base, ...tones];
}

export function hasSkinToneChoices(base: string): boolean {
  return skinToneChoices(base).length > 0;
}

/** A base under the reader's default tone, or unchanged when it has no tones. */
export function withSkinTone(base: string, toneIndex: number): string {
  if (!hasSkinToneChoices(base)) return base;
  const toned = applySkinTone(base, toneIndex);
  return isOfferedEmoji(toned) ? toned : base;
}

/** The category the tone swatches themselves are drawn from. */
export const TONE_SWATCH_BASE = '\u{270B}';

export function listBrowsableCategories(): EmojiCategory[] {
  return listReactionEmojiGroups()
    .map((group) => ({
      key: group.key,
      label: group.label,
      icon: group.icon,
      emojis: group.emojis.filter((emoji) => BROWSABLE_SET.has(emoji))
    }))
    .filter((category) => category.emojis.length > 0);
}
