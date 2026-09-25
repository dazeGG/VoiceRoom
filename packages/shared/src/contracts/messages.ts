// Messages over HTTP: the room chat and direct messages (send, edit, delete,
// mark read), their paginated history, and the parts every message carries.

import { Type, type Static } from 'typebox';
import { Failure, Nullable, Ok } from './http.ts';
import { PublicUser } from './users.ts';

// --- the parts of a message --------------------------------------------------

export const MessageContent = Type.Object({
  version: Type.Literal(1),
  segments: Type.Array(
    Type.Union([
      Type.Object({ type: Type.Literal('text'), text: Type.String() }),
      Type.Object({ type: Type.Literal('link'), href: Type.String(), label: Type.String() }),
      Type.Object({ type: Type.Literal('mention'), userId: Type.String(), label: Type.String() })
    ])
  )
});
export type MessageContent = Static<typeof MessageContent>;

/** An image on a message: public fields only; `url` is set once it is ready. */
export const Attachment = Type.Object({
  id: Type.String(),
  context: Type.String(),
  order: Type.Number(),
  mimeType: Nullable(Type.String()),
  bytes: Nullable(Type.Number()),
  width: Nullable(Type.Number()),
  height: Nullable(Type.Number()),
  state: Type.String(),
  url: Nullable(Type.String())
});
export type Attachment = Static<typeof Attachment>;

export const LinkPreview = Type.Object({
  url: Type.String(),
  title: Type.String(),
  description: Type.String(),
  siteName: Type.String(),
  image: Nullable(Type.Object({ key: Type.String(), width: Type.Number(), height: Type.Number() }))
});
export type LinkPreview = Static<typeof LinkPreview>;

export const ReplyPointer = Type.Object({ messageId: Type.String() });
export type ReplyPointer = Static<typeof ReplyPointer>;

/** The quoted message a reply shows; a deleted target is a tombstone. */
export const ReplyPreview = Type.Object({
  messageId: Type.String(),
  deleted: Type.Boolean(),
  author: Type.Optional(Type.Object({ id: Type.Optional(Type.String()), name: Type.Optional(Type.String()) })),
  text: Type.Optional(Type.String())
});
export type ReplyPreview = Static<typeof ReplyPreview>;

/** A message failure; a rate limit says when to try again, a room refusal names the room. */
export const MessageFailure = Type.Object({
  ...Failure.properties,
  roomId: Type.Optional(Type.String())
});

export const MessageParams = Type.Object({ roomId: Type.String(), messageId: Type.String() });

// --- the room chat -------------------------------------------------------------

export const RoomMessage = Type.Object({
  authorUserId: Nullable(Type.String()),
  avatarAccent: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarUrl: Nullable(Type.String()),
  createdAt: Type.Number(),
  editedAt: Nullable(Type.Number()),
  expiresAt: Type.Optional(Nullable(Type.Number())),
  id: Type.String(),
  name: Type.String(),
  peerId: Type.String(),
  roomId: Type.String(),
  text: Type.String(),
  content: Type.Optional(Nullable(MessageContent)),
  attachments: Type.Array(Attachment),
  linkPreview: Type.Optional(LinkPreview),
  replyTo: Type.Optional(Nullable(ReplyPointer)),
  replyPreview: Type.Optional(Nullable(ReplyPreview))
});
export type RoomMessage = Static<typeof RoomMessage>;

export const RoomChat = Ok({ messages: Type.Array(RoomMessage), roomId: Type.String() });
export type RoomChat = Static<typeof RoomChat>;

/** A guest proves which live peer writes; an account needs neither field. */
const PeerClaim = {
  peerId: Type.Optional(Type.String()),
  sessionToken: Type.Optional(Type.String())
};

/**
 * Structured content as sent: any object. The send path validates it and
 * answers invalid_message_content or invalid_mention_target itself.
 */
export const ContentInput = Type.Object({}, { additionalProperties: true });

export const PostRoomMessageBody = Type.Object({
  ...PeerClaim,
  name: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  content: Type.Optional(ContentInput),
  attachmentIds: Type.Optional(Type.Array(Type.String())),
  replyTo: Type.Optional(Nullable(ReplyPointer)),
  idempotencyKey: Type.Optional(Type.String())
});
export type PostRoomMessageBody = Static<typeof PostRoomMessageBody>;

export const EditRoomMessageBody = Type.Object({ ...PeerClaim, text: Type.Optional(Type.String()) });
export const DeleteRoomMessageBody = Type.Object(PeerClaim);

export const RoomMessageAnswer = Ok({ message: RoomMessage });
export type RoomMessageAnswer = Static<typeof RoomMessageAnswer>;

export const MessageDeleted = Ok({ deleted: Type.Literal(true) });
export type MessageDeleted = Static<typeof MessageDeleted>;

export const ReadBody = Type.Object({ cursor: Type.Optional(Type.String()) });

/**
 * A read with a cursor moves the durable read point (`advanced`, `cursor`);
 * the older read without one marks everything up to now (`lastReadAt`).
 */
export const RoomRead = Ok({
  advanced: Type.Optional(Type.Boolean()),
  cursor: Type.Optional(Type.String()),
  lastReadAt: Type.Optional(Type.Number()),
  unreadCount: Type.Optional(Type.Number())
});
export type RoomRead = Static<typeof RoomRead>;

// --- direct messages -------------------------------------------------------------

/** A room invitation carried by a direct message; its status changes arrive as edits. */
export const DirectMessageInvite = Type.Object({
  roomId: Type.String(),
  roomName: Type.String(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('accepted'),
    Type.Literal('declined'),
    Type.Literal('expired')
  ]),
  expiresAt: Nullable(Type.Number())
});
export type DirectMessageInvite = Static<typeof DirectMessageInvite>;

export const DirectMessage = Type.Object({
  id: Type.String(),
  senderId: Type.String(),
  recipientId: Type.String(),
  body: Type.String(),
  createdAt: Nullable(Type.Number()),
  editedAt: Nullable(Type.Number()),
  readAt: Nullable(Type.Number()),
  invite: Nullable(DirectMessageInvite),
  attachments: Type.Optional(Type.Array(Attachment)),
  linkPreview: Type.Optional(LinkPreview),
  replyTo: Type.Optional(Nullable(ReplyPointer)),
  replyPreview: Type.Optional(Nullable(ReplyPreview))
});
export type DirectMessage = Static<typeof DirectMessage>;

export const PeerParams = Type.Object({ userId: Type.String() });
export const DirectMessageParams = Type.Object({ userId: Type.String(), messageId: Type.String() });

export const DirectThread = Ok({ peer: PublicUser, messages: Type.Array(DirectMessage), muted: Type.Boolean() });
export type DirectThread = Static<typeof DirectThread>;

export const SendDirectMessageBody = Type.Object({
  text: Type.Optional(Type.String()),
  attachmentIds: Type.Optional(Type.Array(Type.String())),
  replyTo: Type.Optional(Nullable(ReplyPointer)),
  idempotencyKey: Type.Optional(Type.String())
});
export type SendDirectMessageBody = Static<typeof SendDirectMessageBody>;

export const EditDirectMessageBody = Type.Object({ text: Type.Optional(Type.String()) });
export const InviteAnswerBody = Type.Object({ action: Type.Optional(Type.String()) });

export const DirectMessageAnswer = Ok({ message: DirectMessage });
export type DirectMessageAnswer = Static<typeof DirectMessageAnswer>;

/** A cursor read answers like the room one; the older read counts what it marked. */
export const DirectRead = Ok({
  advanced: Type.Optional(Type.Boolean()),
  cursor: Type.Optional(Type.String()),
  count: Type.Optional(Type.Number())
});
export type DirectRead = Static<typeof DirectRead>;

// --- history pages ---------------------------------------------------------------

export const HistoryQuery = Type.Object({
  mode: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
  /** With mode=around and no cursor: the page around this message. */
  messageId: Type.Optional(Type.String())
});

/** Older room messages have plain text instead of structured content. */
export const HistoryContent = Type.Union([
  MessageContent,
  Type.Object({ type: Type.Literal('text'), text: Type.String() })
]);

const HistoryMessageFields = {
  id: Type.String(),
  createdAt: Nullable(Type.Number()),
  content: HistoryContent,
  editedAt: Type.Optional(Nullable(Type.Number())),
  attachments: Type.Optional(Type.Array(Attachment)),
  linkPreview: Type.Optional(LinkPreview),
  replyTo: Type.Optional(Nullable(ReplyPointer)),
  replyPreview: Type.Optional(Nullable(ReplyPreview)),
  /** Opaque: where to page from. */
  cursor: Type.String(),
  /** Opaque: what to send to mark the conversation read up to here. */
  readCursor: Type.String()
};

export const RoomHistoryMessage = Type.Object({
  ...HistoryMessageFields,
  kind: Type.Literal('room'),
  author: Type.Object({
    userId: Nullable(Type.String()),
    peerId: Type.String(),
    name: Type.String(),
    avatarColorKey: Nullable(Type.String()),
    avatarUrl: Nullable(Type.String()),
    avatarAccent: Nullable(Type.String())
  }),
  expiresAt: Type.Optional(Nullable(Type.Number()))
});
export type RoomHistoryMessage = Static<typeof RoomHistoryMessage>;

/** What a direct message's metadata can say: a room invitation and a link preview. */
export const DirectMessageMetadata = Type.Object({
  kind: Type.Optional(Type.String()),
  roomId: Type.Optional(Type.String()),
  roomName: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  expiresAt: Type.Optional(Nullable(Type.Number())),
  linkPreview: Type.Optional(LinkPreview)
});

export const DirectHistoryMessage = Type.Object({
  ...HistoryMessageFields,
  kind: Type.Literal('dm'),
  author: Type.Object({ userId: Type.String() }),
  recipientId: Type.String(),
  readAt: Type.Optional(Nullable(Type.Number())),
  metadata: Type.Optional(Nullable(DirectMessageMetadata))
});
export type DirectHistoryMessage = Static<typeof DirectHistoryMessage>;

function HistoryPage<Message extends typeof RoomHistoryMessage | typeof DirectHistoryMessage>(message: Message) {
  return Type.Object({
    contractVersion: Type.Literal(1),
    mode: Type.Union([Type.Literal('latest'), Type.Literal('before'), Type.Literal('after'), Type.Literal('around')]),
    messages: Type.Array(message),
    pageInfo: Type.Object({
      before: Type.Optional(Type.String()),
      after: Type.Optional(Type.String()),
      around: Type.Optional(Type.String()),
      hasMoreBefore: Type.Boolean(),
      hasMoreAfter: Type.Boolean()
    })
  });
}

export const RoomHistoryPage = HistoryPage(RoomHistoryMessage);
export type RoomHistoryPage = Static<typeof RoomHistoryPage>;

export const DirectHistoryPage = HistoryPage(DirectHistoryMessage);
export type DirectHistoryPage = Static<typeof DirectHistoryPage>;

// --- reactions ---------------------------------------------------------------------

/** A message's reactions: `type` is 'room' or 'dm', `conversationId` the room or the peer. */
export const ReactionParams = Type.Object({
  type: Type.String(),
  conversationId: Type.String(),
  messageId: Type.String()
});

export const ReactionSummary = Type.Object({
  emoji: Type.String(),
  count: Type.Number(),
  reactedByMe: Type.Boolean(),
  revision: Type.String()
});
export type ReactionSummary = Static<typeof ReactionSummary>;

export const ReactionSummaries = Ok({ summaries: Type.Array(ReactionSummary) });
export type ReactionSummaries = Static<typeof ReactionSummaries>;

/** Sets the viewer's reaction on or off; replaying the same state changes nothing. */
export const ReactionBody = Type.Object({ emoji: Type.Optional(Type.String()), active: Type.Optional(Type.Boolean()) });
export const ReactionSet = Ok({ summary: ReactionSummary });
export type ReactionSet = Static<typeof ReactionSet>;

export const ReactorsQuery = Type.Object({
  emoji: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String())
});

export const Reactor = Type.Object({
  userId: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String())
});
export const ReactorPage = Ok({ reactors: Type.Array(Reactor), nextCursor: Nullable(Type.String()) });
export type ReactorPage = Static<typeof ReactorPage>;

// --- pins ------------------------------------------------------------------------------

export const PinnedMessage = Type.Object({
  messageId: Type.String(),
  pinnedBy: Type.String(),
  pinnedByName: Type.String(),
  pinnedAt: Nullable(Type.Number()),
  author: Type.Object({ peerId: Type.String(), userId: Nullable(Type.String()), name: Type.String() }),
  text: Type.String(),
  content: Nullable(MessageContent),
  createdAt: Nullable(Type.Number())
});
export type PinnedMessage = Static<typeof PinnedMessage>;

/** Every pin answer is the room's whole list, so a client never reconciles a partial update. */
export const PinList = Ok({ pins: Type.Array(PinnedMessage), count: Type.Number() });
export type PinList = Static<typeof PinList>;
