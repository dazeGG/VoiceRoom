// A room chat message as clients see it (RoomMessage in
// @voice-room/shared/contracts/messages): the HTTP answers, the realtime
// events and the legacy list all send this shape.

import type {
  Attachment,
  LinkPreview,
  MessageContent,
  ReplyPointer,
  ReplyPreview,
  RoomMessage
} from '@voice-room/shared/contracts/messages';
import { isRecord } from '@voice-room/shared/guards';
import { avatarColorForPeerId } from '../rooms/avatar-color.ts';

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
  content?: MessageContent | null;
  attachments?: Attachment[];
  linkPreview?: LinkPreview | null;
  replyTo?: ReplyPointer | null;
  replyPreview?: ReplyPreview | null;
  idempotencyReplay?: boolean;
}

/**
 * A chat message read back from JSON this API wrote (an outbox event, an
 * idempotent replay): checked for the id it is known by; the rest is as the
 * writer stored it.
 */
export function isStoredChatMessage(value: unknown): value is RoomChatMessage {
  return isRecord(value) && typeof value.id === 'string';
}

export function publicChatMessage(message: RoomChatMessage): RoomMessage {
  return {
    authorUserId: message.authorUserId || null,
    avatarAccent: message.avatarAccent || null,
    avatarColorKey: message.avatarColorKey || avatarColorForPeerId(message.peerId),
    avatarUrl:
      message.avatarUrl || (message.avatarKey ? `/api/avatars/${encodeURIComponent(message.avatarKey)}` : null),
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
