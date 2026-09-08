/** The five Unicode skin-tone modifiers, lightest first. */
export const SKIN_TONES: readonly string[];

/** Whether the picker hides this sequence behind a toneless base. */
export function isCollapsedSkinToneVariant(emoji: string): boolean;

/**
 * The five tone variants of a base, lightest first, or an empty array when the
 * base has no tones or is not collapsible.
 */
export function listSkinToneVariants(base: string): readonly string[];

export function hasSkinToneVariants(base: string): boolean;

/**
 * Resolve a base to one tone. `toneIndex` is 0-4; anything else - including the
 * "no preference" case - yields the neutral base unchanged.
 */
export function applySkinTone(base: string, toneIndex: number): string;

/** The toneless base of any sequence; returns the input when it carries none. */
export function skinToneBase(emoji: string): string;

/** Corpus order, with every collapsible tone variant folded into its base. */
export function listCollapsedReactionEmojis(): readonly string[];
