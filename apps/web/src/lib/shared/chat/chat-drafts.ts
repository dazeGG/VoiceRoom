import type { ConversationRef } from '@voice-room/shared/contracts/realtime';
import { isArray, isRecord } from '@voice-room/shared/guards';
import { MAX_MENTIONS_PER_MESSAGE } from '@voice-room/shared/mentions';
import type { SelectedMention } from './mention-composer.svelte';

// Unsent text is kept per account and per chat on this device only. Nothing is
// sent to the server, and signing out wipes every draft on the device.

export type ChatDraftScope = ConversationRef;

export interface ChatDraft {
  text: string;
  mentions: SelectedMention[];
  updatedAt: number;
}

const STORAGE_PREFIX = 'voice-room:chat-drafts';
export const MAX_CHAT_DRAFTS = 50;
export const CHAT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_LENGTH = 2000;

// Set while signed out: components that close after the session ended still
// try to store what was in their composer, and that must not bring drafts back.
let locked = false;

export function chatDraftStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function chatDraftScopeKey(scope: ChatDraftScope): string {
  return `${scope.type}:${scope.id}`;
}

function normalizeMentions(value: unknown, text: string): SelectedMention[] {
  if (!isArray(value)) return [];
  const seen = new Set<string>();
  const mentions: SelectedMention[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { userId, login, displayName } = entry;
    if (typeof userId !== 'string' || !userId || typeof login !== 'string' || !login) continue;
    // A mention whose @login was edited out of the text would otherwise be
    // sent as a notification the text no longer shows.
    if (seen.has(userId) || !text.includes(`@${login}`)) continue;
    seen.add(userId);
    mentions.push({ userId, login, displayName: typeof displayName === 'string' ? displayName : login });
    if (mentions.length >= MAX_MENTIONS_PER_MESSAGE) break;
  }
  return mentions;
}

export function normalizeChatDrafts(value: unknown, now = Date.now()): Record<string, ChatDraft> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, ChatDraft]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (!/^(dm|room):./.test(key) || !isRecord(candidate)) continue;
    const text = typeof candidate.text === 'string' ? candidate.text.slice(0, MAX_DRAFT_LENGTH) : '';
    const updatedAt = Number(candidate.updatedAt);
    if (!text.trim() || !Number.isFinite(updatedAt) || now - updatedAt > CHAT_DRAFT_MAX_AGE_MS) continue;
    entries.push([key, { text, mentions: normalizeMentions(candidate.mentions, text), updatedAt }]);
  }
  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_CHAT_DRAFTS));
}

function readDrafts(userId: string, now: number): Record<string, ChatDraft> {
  try {
    const raw = globalThis.localStorage?.getItem(chatDraftStorageKey(userId));
    return raw ? normalizeChatDrafts(JSON.parse(raw), now) : {};
  } catch {
    return {};
  }
}

function writeDrafts(userId: string, drafts: Record<string, ChatDraft>): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (Object.keys(drafts).length === 0) storage.removeItem(chatDraftStorageKey(userId));
    else storage.setItem(chatDraftStorageKey(userId), JSON.stringify(drafts));
  } catch {
    // Without storage a draft lives only as long as its chat stays open.
  }
}

export function loadChatDraft(userId: string, scope: ChatDraftScope, now = Date.now()): ChatDraft | null {
  if (locked || !userId || !scope.id) return null;
  return readDrafts(userId, now)[chatDraftScopeKey(scope)] ?? null;
}

export function saveChatDraft(
  userId: string,
  scope: ChatDraftScope,
  draft: { text: string; mentions?: readonly SelectedMention[] },
  now = Date.now()
): void {
  if (locked || !userId || !scope.id) return;
  const drafts = readDrafts(userId, now);
  const key = chatDraftScopeKey(scope);
  const text = draft.text.slice(0, MAX_DRAFT_LENGTH);
  if (text.trim()) {
    drafts[key] = { text, mentions: normalizeMentions(draft.mentions ?? [], text), updatedAt: now };
    writeDrafts(userId, normalizeChatDrafts(drafts, now));
  } else if (key in drafts) {
    const { [key]: _cleared, ...rest } = drafts;
    writeDrafts(userId, normalizeChatDrafts(rest, now));
  }
}

export function clearChatDrafts(): void {
  locked = true;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing was stored if storage is unavailable.
  }
}

export function resumeChatDrafts(): void {
  locked = false;
}
