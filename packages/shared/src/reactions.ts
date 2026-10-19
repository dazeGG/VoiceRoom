// Emoji reactions on a message: the toggle a client sends, and the checks on
// the per-emoji summary and the paginated list of who reacted (their shapes
// are contracts/messages.ts).

import type { Reactor, ReactorList, ReactionSummary } from './contracts/messages.ts';
import { cleanReactionEmoji } from './emoji.ts';
import { isArray, isRecord } from './guards.ts';

export type ReactionMutation = { messageId: string; emoji: string; active: boolean };

export const DEFAULT_REACTOR_LIMIT = 50;
export const MAX_REACTOR_LIMIT = 100;

function cleanId(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 128 ? text : '';
}

function cleanCursor(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 4096 ? text : '';
}

export function normalizeReactionMutation(value: unknown): ReactionMutation | null {
  if (!isRecord(value)) return null;
  const input = value;
  const messageId = cleanId(input.messageId);
  const emoji: string = cleanReactionEmoji(input.emoji);
  if (!messageId || !emoji || typeof input.active !== 'boolean') return null;
  return { messageId, emoji, active: input.active };
}

export function normalizeReactionRevision(value: unknown): string | null {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    typeof value !== 'boolean'
  ) {
    return null;
  }
  try {
    const revision = BigInt(value);
    return revision >= 0n ? revision.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeReactionSummary(value: unknown): ReactionSummary | null {
  if (!isRecord(value)) return null;
  const input = value;
  const emoji: string = cleanReactionEmoji(input.emoji);
  const count = Number(input.count);
  const revision = normalizeReactionRevision(input.revision);
  if (!emoji || !Number.isSafeInteger(count) || count < 0 || !revision || typeof input.reactedByMe !== 'boolean')
    return null;
  return { emoji, count, reactedByMe: input.reactedByMe, revision };
}

export function normalizeReactorQuery(value: unknown = {}): { cursor: string | null; limit: number } | null {
  const input = isRecord(value) ? value : {};
  const limit = input.limit == null ? DEFAULT_REACTOR_LIMIT : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REACTOR_LIMIT) return null;
  const cursor = input.cursor == null ? null : cleanCursor(input.cursor);
  if (input.cursor != null && !cursor) return null;
  return { cursor, limit };
}

export function normalizeReactorPage(value: unknown): ReactorList | null {
  if (!isRecord(value) || !isArray(value.reactors)) return null;
  const input = value;
  if (value.reactors.length > MAX_REACTOR_LIMIT) return null;
  const reactors: Reactor[] = [];
  for (const reactor of value.reactors) {
    const entry = normalizeReactor(reactor);
    if (!entry) return null;
    reactors.push(entry);
  }
  const nextCursor = input.nextCursor == null ? null : cleanCursor(input.nextCursor);
  if (input.nextCursor != null && !nextCursor) return null;
  return { reactors, nextCursor };
}

function normalizeReactor(value: unknown): Reactor | null {
  if (!isRecord(value)) return null;
  const userId = cleanId(value.userId);
  const displayName = typeof value.displayName === 'string' ? value.displayName.slice(0, 256) : '';
  if (!userId || !displayName) return null;
  return {
    userId,
    displayName,
    avatarUrl: typeof value.avatarUrl === 'string' && value.avatarUrl ? value.avatarUrl : null
  };
}
