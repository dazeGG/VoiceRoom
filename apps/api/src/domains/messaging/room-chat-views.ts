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
import { avatarColorForPeerId } from '../../lib/room-store.ts';

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

export function publicChatMessage(message: RoomChatMessage): RoomMessage {
  return {
    authorUserId: message.authorUserId || null,
    avatarAccent: message.avatarAccent || null,
    avatarColorKey: message.avatarColorKey || (avatarColorForPeerId(message.peerId) as string),
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
