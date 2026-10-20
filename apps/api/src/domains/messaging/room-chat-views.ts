// A room chat message as clients see it (RoomMessage in
// @voice-room/shared/contracts/messages): the HTTP answers, the realtime
// events and the legacy list all send this shape.

import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { Nullable } from '@voice-room/shared/contracts/http';
import {
  Attachment,
  LinkPreview,
  MessageContent,
  ReplyPointer,
  ReplyPreview,
  RoomMessage
} from '@voice-room/shared/contracts/messages';
import { avatarColorForPeerId } from '../rooms/avatar-color.ts';

const Absent = <Schema extends TSchema>(schema: Schema) => Type.Optional(Nullable(schema));

/**
 * A room chat message as the API stores and passes it: the contract
 * RoomMessage with the fields its public view fills in left optional, plus
 * the server-side avatar key and replay flag.
 */
export const StoredChatMessage = Type.Object({
  ...RoomMessage.properties,
  expiresAt: Absent(Type.Number()),
  editedAt: Absent(Type.Number()),
  authorUserId: Absent(Type.String()),
  avatarAccent: Absent(Type.String()),
  avatarColorKey: Absent(Type.String()),
  avatarKey: Absent(Type.String()),
  avatarUrl: Absent(Type.String()),
  content: Absent(MessageContent),
  attachments: Type.Optional(Type.Array(Attachment)),
  linkPreview: Absent(LinkPreview),
  replyTo: Absent(ReplyPointer),
  replyPreview: Absent(ReplyPreview),
  idempotencyReplay: Type.Optional(Type.Boolean())
});
export type RoomChatMessage = Static<typeof StoredChatMessage>;

/** A chat message read back from JSON this API wrote (an outbox event, an idempotent replay). */
export function isStoredChatMessage(value: unknown): value is RoomChatMessage {
  return Value.Check(StoredChatMessage, value);
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
    ...(message.expiresAt === undefined ? {} : { expiresAt: message.expiresAt }),
    id: message.id,
    name: message.name,
    peerId: message.peerId,
    roomId: message.roomId,
    text: message.text,
    ...(message.content === undefined ? {} : { content: message.content }),
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    ...(message.linkPreview ? { linkPreview: message.linkPreview } : {}),
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
    ...(message.replyPreview === undefined ? {} : { replyPreview: message.replyPreview })
  };
}
