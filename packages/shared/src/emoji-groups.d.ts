export interface ReactionEmojiGroup {
  key: string;
  label: string;
  icon: string;
  emojis: readonly string[];
}

export function listReactionEmojiGroups(): readonly ReactionEmojiGroup[];

export function reactionEmojiGroupKey(emoji: string): string;
