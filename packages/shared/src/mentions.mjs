const MENTIONS_CONTRACT_VERSION = 1;
const MAX_MENTIONS_PER_MESSAGE = 5;
const MAX_MENTION_CANDIDATES = 8;

function cleanId(value, max = 128) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return id && id.length <= max ? id : '';
}

function normalizeMentionUserIds(value, { creatorUserId = '' } = {}) {
  if (!Array.isArray(value)) return { ok: false, code: 'invalid_mentions' };
  const creatorId = cleanId(creatorUserId);
  const unique = [];
  const seen = new Set();
  for (const candidate of value) {
    const userId = cleanId(typeof candidate === 'string' ? candidate : candidate?.userId);
    if (!userId) return { ok: false, code: 'invalid_mention_target' };
    if (userId === creatorId) return { ok: false, code: 'self_mention' };
    if (seen.has(userId)) continue;
    seen.add(userId);
    unique.push(userId);
    if (unique.length > MAX_MENTIONS_PER_MESSAGE) return { ok: false, code: 'too_many_mentions' };
  }
  return { ok: true, userIds: unique };
}

function mentionUserIdsFromContent(content, options) {
  if (!content || content.version !== 1 || !Array.isArray(content.segments)) {
    return { ok: true, userIds: [] };
  }
  return normalizeMentionUserIds(
    content.segments
      .filter((segment) => segment?.type === 'mention')
      .map((segment) => segment.userId),
    options
  );
}

export {
  MAX_MENTION_CANDIDATES,
  MAX_MENTIONS_PER_MESSAGE,
  MENTIONS_CONTRACT_VERSION,
  mentionUserIdsFromContent,
  normalizeMentionUserIds
};