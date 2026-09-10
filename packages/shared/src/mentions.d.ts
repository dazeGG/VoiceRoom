export const MENTIONS_CONTRACT_VERSION: 1;
export const MAX_MENTIONS_PER_MESSAGE: 5;
export const MAX_MENTION_CANDIDATES: 8;
export type MentionNormalization = { ok: true; userIds: string[] } | { ok: false; code: string };
export function normalizeMentionUserIds(value: unknown, options?: { creatorUserId?: string }): MentionNormalization;
export function mentionUserIdsFromContent(value: unknown, options?: { creatorUserId?: string }): MentionNormalization;
