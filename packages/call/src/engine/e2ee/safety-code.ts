// The 4-emoji safety code of an E2EE 1:1 call: 24 bits of the agreed secret, 6 bits per emoji.
//
// The table is part of the protocol: both sides must map the same bits to the same emoji, so it never changes
// order within a protocol version. Its 64 entries are visually distinct and easy to name aloud, so two people
// can compare codes over the call itself.

export const SAFETY_EMOJI = Object.freeze([
  '🐶',
  '🐱',
  '🐭',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🦉',
  '🐴',
  '🦄',
  '🐝',
  '🦋',
  '🐌',
  '🐞',
  '🐢',
  '🐍',
  '🐙',
  '🦀',
  '🐬',
  '🐳',
  '🦈',
  '🐘',
  '🦒',
  '🌵',
  '🌲',
  '🍀',
  '🍁',
  '🍄',
  '🌻',
  '🌙',
  '⭐',
  '🔥',
  '🌈',
  '⛄',
  '⚡',
  '🍎',
  '🍌',
  '🍉',
  '🍇',
  '🍓',
  '🍒',
  '🍍',
  '🥕',
  '🌽',
  '🍕',
  '🎂',
  '🍩',
  '⚽',
  '🎸',
  '🚀',
  '🚲',
  '🔑',
  '⏰',
  '🎈',
  '🎁'
] as const);

export type SafetyEmoji = (typeof SAFETY_EMOJI)[number];

function emojiAt(index: number): SafetyEmoji {
  const emoji = SAFETY_EMOJI[index];
  if (emoji === undefined) throw new RangeError(`No safety emoji at ${index}`);
  return emoji;
}

/** Four emoji from the first 24 bits of `bytes`, most significant bits first. */
export function safetyCode(bytes: Uint8Array): SafetyEmoji[] {
  const [high, middle, low] = bytes;
  if (high === undefined || middle === undefined || low === undefined)
    throw new RangeError('A safety code needs 24 bits');
  const bits = (high << 16) | (middle << 8) | low;
  return [18, 12, 6, 0].map((shift) => emojiAt((bits >> shift) & 63));
}
