import {
  normalizeReactionSummary,
  normalizeReactorPage,
  type ReactionSummary,
  type ReactorPage
} from '@voice-room/shared/reactions';
import { getJsonAuth, putJson } from './http';

export type ReactionConversation = { type: 'room' | 'dm'; id: string };

function reactionUrl(conversation: ReactionConversation, messageId: string): string {
  return `/api/reactions/${conversation.type}/${encodeURIComponent(conversation.id)}/${encodeURIComponent(messageId)}`;
}

function validSummaries(value: unknown): ReactionSummary[] {
  if (!Array.isArray(value)) throw new Error('Сервер вернул неверные реакции');
  const summaries = value.map(normalizeReactionSummary);
  if (summaries.some((summary) => !summary)) throw new Error('Сервер вернул неверные реакции');
  return summaries as ReactionSummary[];
}

export async function fetchReactionSummaries(
  conversation: ReactionConversation,
  messageId: string
): Promise<ReactionSummary[]> {
  const payload = await getJsonAuth<{ ok: true; summaries: unknown }>(reactionUrl(conversation, messageId));
  return validSummaries(payload.summaries);
}

export async function setReactionDesired(
  conversation: ReactionConversation,
  messageId: string,
  emoji: string,
  active: boolean
): Promise<ReactionSummary> {
  const payload = await putJson<{ ok: true; summary: unknown }>(reactionUrl(conversation, messageId), { emoji, active });
  const summary = normalizeReactionSummary(payload.summary);
  if (!summary) throw new Error('Сервер вернул неверную реакцию');
  return summary;
}

export async function fetchReactors(
  conversation: ReactionConversation,
  messageId: string,
  emoji: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<ReactorPage> {
  const params = new URLSearchParams({
    emoji,
    limit: String(options.limit ?? 50)
  });
  if (options.cursor) params.set('cursor', options.cursor);
  const payload = await getJsonAuth<unknown>(`${reactionUrl(conversation, messageId)}/reactors?${params}`);
  const page = normalizeReactorPage(payload);
  if (!page) throw new Error('Сервер вернул неверный список реакций');
  return page;
}
