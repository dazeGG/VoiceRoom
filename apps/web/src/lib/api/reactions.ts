import type {
  ReactionSet,
  ReactionSummaries,
  ReactionSummary,
  ReactorPage as ReactorPageAnswer
} from '@voice-room/shared/contracts/messages';
import type { ReactorPage } from '@voice-room/shared/reactions';
import { api } from './client';

export type ReactionConversation = { type: 'room' | 'dm'; id: string };

function reactionUrl(conversation: ReactionConversation, messageId: string): string {
  return `/api/reactions/${conversation.type}/${encodeURIComponent(conversation.id)}/${encodeURIComponent(messageId)}`;
}

export async function fetchReactionSummaries(
  conversation: ReactionConversation,
  messageId: string
): Promise<ReactionSummary[]> {
  return (await api.get<ReactionSummaries>(reactionUrl(conversation, messageId))).summaries;
}

export async function setReactionDesired(
  conversation: ReactionConversation,
  messageId: string,
  emoji: string,
  active: boolean
): Promise<ReactionSummary> {
  return (await api.put<ReactionSet>(reactionUrl(conversation, messageId), { emoji, active })).summary;
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
  const { reactors, nextCursor } = await api.get<ReactorPageAnswer>(
    `${reactionUrl(conversation, messageId)}/reactors?${params}`
  );
  return { reactors, nextCursor };
}
