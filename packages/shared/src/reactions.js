'use strict';

const { cleanReactionEmoji } = require('./emoji');

const DEFAULT_REACTOR_LIMIT = 50;
const MAX_REACTOR_LIMIT = 100;

function cleanId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 128 ? text : '';
}

function normalizeReactionMutation(value) {
  if (!value || typeof value !== 'object') return null;
  const messageId = cleanId(value.messageId);
  const emoji = cleanReactionEmoji(value.emoji);
  if (!messageId || !emoji || typeof value.active !== 'boolean') return null;
  return { messageId, emoji, active: value.active };
}

function normalizeReactionRevision(value) {
  try {
    const revision = BigInt(value);
    return revision >= 0n ? revision.toString() : null;
  } catch {
    return null;
  }
}

function normalizeReactionSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const emoji = cleanReactionEmoji(value.emoji);
  const count = Number(value.count);
  const revision = normalizeReactionRevision(value.revision);
  if (!emoji || !Number.isSafeInteger(count) || count < 0 || !revision || typeof value.reactedByMe !== 'boolean') return null;
  return { emoji, count, reactedByMe: value.reactedByMe, revision };
}

function normalizeReactorQuery(value = {}) {
  const limit = value.limit == null ? DEFAULT_REACTOR_LIMIT : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REACTOR_LIMIT) return null;
  const cursor = value.cursor == null ? null : cleanId(value.cursor);
  if (value.cursor != null && !cursor) return null;
  return { cursor, limit };
}

function normalizeReactorPage(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.reactors)) return null;
  const reactors = value.reactors.map((reactor) => {
    const userId = cleanId(reactor?.userId);
    const displayName = typeof reactor?.displayName === 'string' ? reactor.displayName.slice(0, 256) : '';
    return userId && displayName ? { userId, displayName, avatarUrl: reactor.avatarUrl || null } : null;
  });
  if (reactors.some((reactor) => !reactor) || reactors.length > MAX_REACTOR_LIMIT) return null;
  const nextCursor = value.nextCursor == null ? null : cleanId(value.nextCursor);
  if (value.nextCursor != null && !nextCursor) return null;
  return { reactors, nextCursor };
}

module.exports = {
  DEFAULT_REACTOR_LIMIT,
  MAX_REACTOR_LIMIT,
  normalizeReactionMutation,
  normalizeReactionRevision,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
};
