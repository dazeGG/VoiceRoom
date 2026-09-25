// Direct (one-to-one) messages. Mirrors the /api/dm/:userId routes.

import type {
  Attachment,
  DirectHistoryMessage,
  DirectHistoryPage,
  DirectMessage as DirectMessageView,
  DirectMessageAnswer,
  DirectRead,
  DirectThread,
  LinkPreview,
  MessageDeleted
} from '@voice-room/shared/contracts/messages';
import { normalizeLinkPreview } from '@voice-room/shared/link-preview';
import type { ReplyTarget } from '$lib/shared/chat/reply-store.svelte';
import { api } from './client';
import type { PublicUser } from './friends';

// A room invitation embedded in a message: rendered as an actionable card in
// the thread instead of a text bubble. Status changes arrive as message edits.
export interface DirectMessageInvite {
  roomId: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: number | null;
}

/** A direct message as the thread UI holds it, with the history cursors when it came from a page. */
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  readAt: number | null;
  invite?: DirectMessageInvite | null;
  cursor?: string;
  readCursor?: string;
  attachments?: Attachment[];
  linkPreview?: LinkPreview;
  replyTo?: { messageId: string };
  replyPreview?: ReplyTarget;
}

export function directMessageFromView(message: DirectMessageView): DirectMessage {
  return {
    ...message,
    createdAt: message.createdAt ?? Date.now(),
    replyTo: message.replyTo ?? undefined,
    replyPreview: message.replyPreview ?? undefined
  };
}

export interface DirectMessageHistoryPage {
  contractVersion: 1;
  mode: 'latest' | 'before' | 'after' | 'around';
  messages: DirectMessage[];
  pageInfo: {
    before?: string;
    after?: string;
    around?: string;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  };
}

// Opening a thread also clears its unread badge server-side.
export async function fetchThread(
  userId: string
): Promise<{ peer: PublicUser; messages: DirectMessage[]; muted: boolean }> {
  const { peer, messages, muted } = await api.get<DirectThread>(`/api/dm/${encodeURIComponent(userId)}`);
  return { peer, messages: messages.map(directMessageFromView), muted };
}

export async function fetchThreadPage(
  userId: string,
  request: {
    mode?: 'latest' | 'before' | 'after' | 'around';
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {}
): Promise<DirectMessageHistoryPage> {
  const params = new URLSearchParams({
    mode: request.mode ?? 'latest',
    limit: String(request.limit ?? 50)
  });
  if (request.cursor) params.set('cursor', request.cursor);
  const page = await api.get<DirectHistoryPage>(`/api/dm/${encodeURIComponent(userId)}/history?${params}`, {
    signal: request.signal,
    fallback: 'Не удалось загрузить переписку'
  });
  return { ...page, messages: page.messages.map(directMessageFromHistory) };
}

const INVITE_STATUSES: readonly string[] = ['accepted', 'declined', 'expired'];

function directMessageFromHistory(message: DirectHistoryMessage): DirectMessage {
  const metadata = message.metadata ?? {};
  const invite: DirectMessageInvite | null =
    metadata.kind === 'room-invite'
      ? {
          roomId: metadata.roomId ?? '',
          roomName: metadata.roomName ?? '',
          status: INVITE_STATUSES.includes(metadata.status ?? '')
            ? (metadata.status as DirectMessageInvite['status'])
            : 'pending',
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
    replyPreview: message.replyPreview ?? undefined
  };
}

export async function sendDirectMessage(
  userId: string,
  text: string,
  attachmentIds: string[] = [],
  replyTo?: { messageId: string },
  idempotencyKey?: string
): Promise<DirectMessage> {
  const payload = await api.post<DirectMessageAnswer>(`/api/dm/${encodeURIComponent(userId)}`, {
    text,
    attachmentIds,
    replyTo,
    idempotencyKey
  });
  return directMessageFromView(payload.message);
}

export async function markThreadRead(userId: string, cursor?: string): Promise<number> {
  const payload = await api.post<DirectRead>(`/api/dm/${encodeURIComponent(userId)}/read`, cursor ? { cursor } : {});
  return payload.count ?? 0;
}

export async function deleteDirectMessage(userId: string, messageId: string): Promise<MessageDeleted> {
  return api.delete<MessageDeleted>(`/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`);
}

export async function editDirectMessage(userId: string, messageId: string, text: string): Promise<DirectMessage> {
  const payload = await api.patch<DirectMessageAnswer>(
    `/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
    { text }
  );
  return directMessageFromView(payload.message);
}

export async function respondRoomInvite(
  userId: string,
  messageId: string,
  action: 'accept' | 'decline'
): Promise<DirectMessage> {
  const payload = await api.post<DirectMessageAnswer>(
    `/api/dm/${encodeURIComponent(userId)}/invites/${encodeURIComponent(messageId)}/respond`,
    { action }
  );
  return directMessageFromView(payload.message);
}
