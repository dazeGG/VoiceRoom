// A room chat message as clients see it: the HTTP answers, the realtime
// events and the legacy list all send this shape (apps/web ChatMessage).

import { avatarColorForPeerId } from '../../lib/room-store.js';

export interface RoomChatMessage {
  id: string;
  roomId: string;
  peerId: string;
  name: string;
  text: string;
  createdAt: number;
  expiresAt?: number | null;
  editedAt?: number | null;
  authorUserId?: string | null;
  avatarAccent?: string | null;
  avatarColorKey?: string | null;
  avatarKey?: string | null;
  avatarUrl?: string | null;
  content?: unknown;
  attachments?: unknown[];
  linkPreview?: unknown;
  replyTo?: { messageId: string } | null;
  replyPreview?: unknown;
  idempotencyReplay?: boolean;
}

export function publicChatMessage(message: RoomChatMessage) {
  return {
    authorUserId: message.authorUserId || null,
    avatarAccent: message.avatarAccent || null,
    avatarColorKey: message.avatarColorKey || (avatarColorForPeerId(message.peerId) as string),
    avatarUrl: message.avatarUrl || (message.avatarKey
      ? `/api/avatars/${encodeURIComponent(message.avatarKey)}`
      : null),
    createdAt: message.createdAt,
    editedAt: message.editedAt || null,
    expiresAt: message.expiresAt,
    id: message.id,
    name: message.name,
    peerId: message.peerId,
    roomId: message.roomId,
    text: message.text,
    content: message.content,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    linkPreview: message.linkPreview || undefined,
    replyTo: message.replyTo,
    replyPreview: message.replyPreview
  };
}
