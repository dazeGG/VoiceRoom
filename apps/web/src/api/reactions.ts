import type { ConversationRef } from '@voice-room/shared/contracts/realtime';
import {
  ReactionBatch,
  ReactionBody,
  ReactionSet,
  ReactorPage,
  type ReactionSummary,
  type ReactorList
} from '@voice-room/shared/contracts/messages';
import { api } from './client';

export type ReactionConversation = ConversationRef;

function reactionUrl(conversation: ReactionConversation, messageId: string): string {
  return `/api/reactions/${conversation.type}/${encodeURIComponent(conversation.id)}/${encodeURIComponent(messageId)}`;
}

/** The reactions of many messages in one request; a message without any is absent. */
export async function fetchReactionBatch(
  conversation: ReactionConversation,
  messageIds: readonly string[]
): Promise<Record<string, ReactionSummary[]>> {
  const url = `/api/reactions/${conversation.type}/${encodeURIComponent(conversation.id)}?ids=${messageIds.map(encodeURIComponent).join(',')}`;
  return (await api.get(url, ReactionBatch)).messages;
}

export async function setReactionDesired(
  conversation: ReactionConversation,
  messageId: string,
  emoji: string,
  active: boolean
): Promise<ReactionSummary> {
  return (
    await api.put(reactionUrl(conversation, messageId), ReactionSet, { emoji, active }, { bodySchema: ReactionBody })
  ).summary;
}

export async function fetchReactors(
  conversation: ReactionConversation,
  messageId: string,
  emoji: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<ReactorList> {
  const params = new URLSearchParams({
    emoji,
    limit: String(options.limit ?? 50)
  });
  if (options.cursor) params.set('cursor', options.cursor);
  const { reactors, nextCursor } = await api.get(
    `${reactionUrl(conversation, messageId)}/reactors?${params}`,
    ReactorPage
  );
  return { reactors, nextCursor };
}
