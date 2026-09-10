// Direct (one-to-one) messages. Mirrors the /api/dm/:userId routes.

import { del, getJsonAuth, patchJson, postJsonAuth } from './http';
import type { PublicUser } from './friends';
import type { MessageAttachment } from '@voice-room/shared/attachments';
import type { ReplyTarget } from '$lib/shared/chat/reply-store.svelte';

// A room invitation embedded in a message: rendered as an actionable card in
// the thread instead of a text bubble. Status changes arrive as message edits.
export interface DirectMessageInvite {
  roomId: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: number | null;
}

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
  attachments?: MessageAttachment[];
  replyTo?: { messageId: string };
  replyPreview?: ReplyTarget;
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

interface HistoryMessageDto {
  id: string;
  createdAt: unknown;
  author?: Record<string, unknown>;
  content?: unknown;
  cursor?: string;
  readCursor?: string;
  attachments?: MessageAttachment[];
  replyTo?: { messageId: string };
  replyPreview?: ReplyTarget;
  editedAt?: unknown;
  readAt?: unknown;
  recipientId?: unknown;
  metadata?: unknown;
}

// Opening a thread also clears its unread badge server-side.
export async function fetchThread(userId: string): Promise<{ peer: PublicUser; messages: DirectMessage[]; muted: boolean }> {
  const payload = await getJsonAuth<{ peer: PublicUser; messages?: DirectMessage[]; muted?: boolean }>(
    `/api/dm/${encodeURIComponent(userId)}`
  );
  return {
    peer: payload.peer,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    muted: Boolean(payload.muted)
  };
}

export async function fetchThreadPage(
  userId: string,
  request: { mode?: 'latest' | 'before' | 'after' | 'around'; cursor?: string; limit?: number; signal?: AbortSignal } = {}
): Promise<DirectMessageHistoryPage> {
  const params = new URLSearchParams({
    mode: request.mode ?? 'latest',
    limit: String(request.limit ?? 50)
  });
  if (request.cursor) params.set('cursor', request.cursor);
  const response = await fetch(`/api/dm/${encodeURIComponent(userId)}/history?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: request.signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить переписку');
  const page = payload as Omit<DirectMessageHistoryPage, 'messages'> & { messages?: HistoryMessageDto[] };
  return {
    ...page,
    messages: Array.isArray(page.messages) ? page.messages.map((message) => directMessageFromHistory(userId, message)) : []
  };
}

function directMessageFromHistory(peerId: string, message: HistoryMessageDto): DirectMessage {
  const author = message.author ?? {};
  const content = typeof message.content === 'object' && message.content !== null
    ? message.content as Record<string, unknown>
    : {};
  const senderId = typeof author.userId === 'string' ? author.userId : peerId;
  const createdAt = typeof message.createdAt === 'number'
    ? message.createdAt
    : Date.parse(String(message.createdAt ?? ''));
  const metadata = typeof message.metadata === 'object' && message.metadata !== null
    ? message.metadata as Record<string, unknown>
    : {};
  const invite = metadata.kind === 'room-invite'
    ? {
        roomId: typeof metadata.roomId === 'string' ? metadata.roomId : '',
        roomName: typeof metadata.roomName === 'string' ? metadata.roomName : '',
        status: ['accepted', 'declined', 'expired'].includes(String(metadata.status))
          ? metadata.status as DirectMessageInvite['status']
          : 'pending' as const,
        expiresAt: Number.isFinite(Number(metadata.expiresAt)) && metadata.expiresAt != null
          ? Number(metadata.expiresAt)
          : null
      }
    : null;
  return {
    id: message.id,
    senderId,
    recipientId: typeof message.recipientId === 'string' ? message.recipientId : (senderId === peerId ? '' : peerId),
    body: typeof content.text === 'string' ? content.text : '',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    editedAt: message.editedAt == null ? null : Number(message.editedAt),
    readAt: message.readAt == null ? null : Number(message.readAt),
    invite,
    cursor: message.cursor,
    readCursor: message.readCursor,
    attachments: message.attachments,
    replyTo: message.replyTo,
    replyPreview: message.replyPreview
  };
}

export async function sendDirectMessage(userId: string, text: string, attachmentIds: string[] = [], replyTo?: { messageId: string }, idempotencyKey?: string): Promise<DirectMessage> {
  const payload = await postJsonAuth<{ message: DirectMessage }>(`/api/dm/${encodeURIComponent(userId)}`, {
    text,
    attachmentIds,
    replyTo,
    idempotencyKey
  });
  return payload.message;
}

export async function markThreadRead(userId: string, cursor?: string): Promise<number> {
  const payload = await postJsonAuth<{ count?: number }>(`/api/dm/${encodeURIComponent(userId)}/read`, cursor ? { cursor } : {});
  return payload.count ?? 0;
}

export async function deleteDirectMessage(userId: string, messageId: string): Promise<{ ok: boolean; deleted?: boolean }> {
  const payload = await del<{ ok: boolean; deleted?: boolean }>(`/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`);
  return payload;
}

export async function editDirectMessage(userId: string, messageId: string, text: string): Promise<DirectMessage> {
  const payload = await patchJson<{ message: DirectMessage }>(
    `/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
    { text }
  );
  return payload.message;
}

export async function respondRoomInvite(
  userId: string,
  messageId: string,
  action: 'accept' | 'decline'
): Promise<DirectMessage> {
  const payload = await postJsonAuth<{ message: DirectMessage }>(
    `/api/dm/${encodeURIComponent(userId)}/invites/${encodeURIComponent(messageId)}/respond`,
    { action }
  );
  return payload.message;
}
