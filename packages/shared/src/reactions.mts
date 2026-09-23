// Emoji reactions on a message: the toggle a client sends, the per-emoji
// summary it receives and the paginated list of who reacted.

import { cleanReactionEmoji } from './emoji.mjs';

export type ReactionMutation = { messageId: string; emoji: string; active: boolean };
export type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean; revision: string };
export type Reactor = { userId: string; displayName: string; avatarUrl: string | null };
export type ReactorPage = { reactors: Reactor[]; nextCursor: string | null };

type Loose = Record<string, unknown>;

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
  if (!value || typeof value !== 'object') return null;
  const input = value as Loose;
  const messageId = cleanId(input.messageId);
  const emoji: string = cleanReactionEmoji(input.emoji);
  if (!messageId || !emoji || typeof input.active !== 'boolean') return null;
  return { messageId, emoji, active: input.active };
}

export function normalizeReactionRevision(value: unknown): string | null {
  try {
    const revision = BigInt(value as string | number | bigint | boolean);
    return revision >= 0n ? revision.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeReactionSummary(value: unknown): ReactionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Loose;
  const emoji: string = cleanReactionEmoji(input.emoji);
  const count = Number(input.count);
  const revision = normalizeReactionRevision(input.revision);
  if (!emoji || !Number.isSafeInteger(count) || count < 0 || !revision || typeof input.reactedByMe !== 'boolean') return null;
  return { emoji, count, reactedByMe: input.reactedByMe, revision };
}

export function normalizeReactorQuery(value: unknown = {}): { cursor: string | null; limit: number } | null {
  const input = value as Loose;
  const limit = input.limit == null ? DEFAULT_REACTOR_LIMIT : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REACTOR_LIMIT) return null;
  const cursor = input.cursor == null ? null : cleanCursor(input.cursor);
  if (input.cursor != null && !cursor) return null;
  return { cursor, limit };
}

export function normalizeReactorPage(value: unknown): ReactorPage | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Loose).reactors)) return null;
  const input = value as Loose;
  const reactors = (input.reactors as (Loose | null)[]).map((reactor) => {
    const userId = cleanId(reactor?.userId);
    const displayName = typeof reactor?.displayName === 'string' ? reactor.displayName.slice(0, 256) : '';
    return userId && displayName ? { userId, displayName, avatarUrl: (reactor?.avatarUrl as string) || null } : null;
  });
  if (reactors.some((reactor) => !reactor) || reactors.length > MAX_REACTOR_LIMIT) return null;
  const nextCursor = input.nextCursor == null ? null : cleanCursor(input.nextCursor);
  if (input.nextCursor != null && !nextCursor) return null;
  return { reactors: reactors as Reactor[], nextCursor };
}
