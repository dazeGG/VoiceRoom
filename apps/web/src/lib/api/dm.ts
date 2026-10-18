// Direct (one-to-one) messages. Mirrors the /api/dm/:userId routes.

import {
  DirectHistoryPage,
  DirectMessageAnswer,
  DirectRead,
  MessageDeleted,
  type DirectHistoryMessage,
  type DirectMessage as DirectMessageView,
  type DirectMessageInvite,
  type ReactionSummary,
  type ReplyPointer,
  type SendDirectMessageBody
} from '@voice-room/shared/contracts/messages';
import { normalizeLinkPreview } from '@voice-room/shared/link-preview';
import type { ReplyTarget } from '$lib/shared/chat/reply-store.svelte';
import type { HistoryPageRequest } from './rooms';
import { api } from './client';

// A room invitation embedded in a message: rendered as an actionable card in
// the thread instead of a text bubble. Status changes arrive as message edits.
export type { DirectMessageInvite };

/** A direct message as the thread UI holds it, with the history cursors when it came from a page. */
export type DirectMessage = Omit<DirectMessageView, 'createdAt' | 'invite' | 'replyTo' | 'replyPreview'> & {
  createdAt: number;
  invite?: DirectMessageInvite | null;
  cursor?: string;
  readCursor?: string;
  replyTo?: ReplyPointer;
  replyPreview?: ReplyTarget;
  /** The reactions a history page carried; realtime keeps the reaction store current after that. */
  reactions?: ReactionSummary[];
};

export function directMessageFromView(message: DirectMessageView): DirectMessage {
  return {
    ...message,
    createdAt: message.createdAt ?? Date.now(),
    replyTo: message.replyTo ?? undefined,
    replyPreview: message.replyPreview ?? undefined
  };
}

export type DirectMessageHistoryPage = Omit<DirectHistoryPage, 'messages'> & { messages: DirectMessage[] };

// Opening a thread also clears its unread badge server-side.
export async function fetchThreadPage(
  userId: string,
  request: Omit<HistoryPageRequest, 'messageId'> = {}
): Promise<DirectMessageHistoryPage> {
  const params = new URLSearchParams({
    mode: request.mode ?? 'latest',
    limit: String(request.limit ?? 50)
  });
  if (request.cursor) params.set('cursor', request.cursor);
  const page = await api.get(`/api/dm/${encodeURIComponent(userId)}/history?${params}`, DirectHistoryPage, {
    signal: request.signal,
    fallback: 'Не удалось загрузить переписку'
  });
  return { ...page, messages: page.messages.map(directMessageFromHistory) };
}

function directMessageFromHistory(message: DirectHistoryMessage): DirectMessage {
  const metadata = message.metadata ?? {};
  const invite: DirectMessageInvite | null =
    metadata.kind === 'room-invite'
      ? {
          roomId: metadata.roomId ?? '',
          roomName: metadata.roomName ?? '',
          status: metadata.status ?? 'pending',
          expiresAt: metadata.expiresAt ?? null
        }
      : null;
  return {
    id: message.id,
    senderId: message.author.userId,
    recipientId: message.recipientId,
    body: 'text' in message.content ? message.content.text : '',
    createdAt: message.createdAt ?? Date.now(),
    editedAt: message.editedAt ?? null,
    readAt: message.readAt ?? null,
    invite,
    cursor: message.cursor,
    readCursor: message.readCursor,
    attachments: message.attachments,
    linkPreview: normalizeLinkPreview(message.linkPreview ?? metadata.linkPreview) ?? undefined,
    replyTo: message.replyTo ?? undefined,
    replyPreview: message.replyPreview ?? undefined,
    reactions: message.reactions
  };
}

export async function sendDirectMessage(
  userId: string,
  text: string,
  attachmentIds: string[] = [],
  replyTo?: { messageId: string },
  idempotencyKey?: string
): Promise<DirectMessage> {
  const body: SendDirectMessageBody = { text, attachmentIds, replyTo, idempotencyKey };
  const payload = await api.post(`/api/dm/${encodeURIComponent(userId)}`, DirectMessageAnswer, body);
  return directMessageFromView(payload.message);
}

export async function markThreadRead(userId: string, cursor?: string): Promise<number> {
  const payload = await api.post(`/api/dm/${encodeURIComponent(userId)}/read`, DirectRead, cursor ? { cursor } : {});
  return payload.count ?? 0;
}

export async function deleteDirectMessage(userId: string, messageId: string): Promise<MessageDeleted> {
  return api.delete(`/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`, MessageDeleted);
}

export async function editDirectMessage(userId: string, messageId: string, text: string): Promise<DirectMessage> {
  const payload = await api.patch(
    `/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
    DirectMessageAnswer,
    { text }
  );
  return directMessageFromView(payload.message);
}

export async function respondRoomInvite(
  userId: string,
  messageId: string,
  action: 'accept' | 'decline'
): Promise<DirectMessage> {
  const payload = await api.post(
    `/api/dm/${encodeURIComponent(userId)}/invites/${encodeURIComponent(messageId)}/respond`,
    DirectMessageAnswer,
    { action }
  );
  return directMessageFromView(payload.message);
}
