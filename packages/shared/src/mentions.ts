// Who a message mentions: unique account ids, never the author, at most five.

export const MENTIONS_CONTRACT_VERSION = 1 as const;
export const MAX_MENTIONS_PER_MESSAGE = 5 as const;
export const MAX_MENTION_CANDIDATES = 8 as const;

export type MentionRefusal = 'invalid_mentions' | 'invalid_mention_target' | 'self_mention' | 'too_many_mentions';
export type MentionNormalization = { ok: true; userIds: string[] } | { ok: false; code: MentionRefusal };

function cleanId(value: unknown, max = 128): string {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return id && id.length <= max ? id : '';
}

export function normalizeMentionUserIds(
  value: unknown,
  { creatorUserId = '' }: { creatorUserId?: string } = {}
): MentionNormalization {
  if (!Array.isArray(value)) return { ok: false, code: 'invalid_mentions' };
  const creatorId = cleanId(creatorUserId);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const userId = cleanId(
      typeof candidate === 'string' ? candidate : (candidate as { userId?: unknown } | null)?.userId
    );
    if (!userId) return { ok: false, code: 'invalid_mention_target' };
    if (userId === creatorId) return { ok: false, code: 'self_mention' };
    if (seen.has(userId)) continue;
    seen.add(userId);
    unique.push(userId);
    if (unique.length > MAX_MENTIONS_PER_MESSAGE) return { ok: false, code: 'too_many_mentions' };
  }
  return { ok: true, userIds: unique };
}

export function mentionUserIdsFromContent(
  content: unknown,
  options?: { creatorUserId?: string }
): MentionNormalization {
  const structured = content as { version?: unknown; segments?: unknown } | null | undefined;
  if (!structured || structured.version !== 1 || !Array.isArray(structured.segments)) {
    return { ok: true, userIds: [] };
  }
  return normalizeMentionUserIds(
    (structured.segments as ({ type?: unknown; userId?: unknown } | null)[])
      .filter((segment) => segment?.type === 'mention')
      .map((segment) => segment?.userId),
    options
  );
}
