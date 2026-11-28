// /api/admin/support/*: the admin app's support inbox. A person writes to the
// official VoiceRoom account; staff with `support.reply` read the conversation,
// answer as VoiceRoom, leave notes for the team and mark it resolved. Which
// staff member answered is shown only here: the person sees VoiceRoom.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';
import { AttachmentKind } from './media.ts';

export const SUPPORT_STATUSES = ['open', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SupportStatus = Type.Enum(SUPPORT_STATUSES);

/** The longest reply or note, the same as a direct message. */
export const SUPPORT_TEXT_MAX_LENGTH = 2_000;

/** The person who wrote; their account page in the admin app is `/accounts/<id>`. */
export const SupportPerson = Type.Object({
  id: Type.String(),
  login: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String())
});
export type SupportPerson = Static<typeof SupportPerson>;

/**
 * Whether VoiceRoom can still answer the person: `blocked` while staff have
 * blocked the account, `deleted` once it is deleted or its deletion is pending.
 */
export const SUPPORT_PERSON_STATES = ['active', 'blocked', 'deleted'] as const;
export type SupportPersonState = (typeof SUPPORT_PERSON_STATES)[number];
export const SupportPersonState = Type.Enum(SUPPORT_PERSON_STATES);

/** The official account next to its answers, with its own avatar like any account's. */
export const SupportOfficial = Type.Object({
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String())
});
export type SupportOfficial = Static<typeof SupportOfficial>;

export const SupportThreadSummary = Type.Object({
  person: SupportPerson,
  status: SupportStatus,
  /** The person wrote after a staff member last opened the conversation. */
  unread: Type.Boolean(),
  lastUserMessageAt: Nullable(Type.Number()),
  /** The newest message either way; null once the person deleted the conversation. */
  lastMessage: Nullable(
    Type.Object({
      text: Type.String(),
      at: Nullable(Type.Number()),
      fromStaff: Type.Boolean(),
      hasAttachments: Type.Boolean()
    })
  )
});
export type SupportThreadSummary = Static<typeof SupportThreadSummary>;

export const SupportThreadsQuery = Type.Object({ status: Type.Optional(SupportStatus) });
export type SupportThreadsQuery = Static<typeof SupportThreadsQuery>;

export const SupportCounts = Type.Object({ open: Type.Number(), resolved: Type.Number() });
export type SupportCounts = Static<typeof SupportCounts>;

/** GET /api/admin/support/threads: one status's conversations, newest first, and the counts of both. */
export const SupportThreadList = Ok({
  threads: Type.Array(SupportThreadSummary),
  counts: SupportCounts,
  /** Open conversations with a message nobody on staff has read yet: the menu badge. */
  openUnread: Type.Number()
});
export type SupportThreadList = Static<typeof SupportThreadList>;

/** GET /api/admin/support/unread: the menu badge alone. */
export const SupportUnread = Ok({ openUnread: Type.Number() });
export type SupportUnread = Static<typeof SupportUnread>;

/**
 * An image or the person's diagnostics file; `url` opens the image or downloads
 * the file through the support route, null while it is not ready.
 */
export const SupportAttachment = Type.Object({
  id: Type.String(),
  kind: Type.Optional(AttachmentKind),
  mimeType: Nullable(Type.String()),
  width: Nullable(Type.Number()),
  height: Nullable(Type.Number()),
  /** The diagnostics file's name and size; null for an image. */
  name: Type.Optional(Nullable(Type.String())),
  bytes: Type.Optional(Nullable(Type.Number())),
  url: Nullable(Type.String())
});
export type SupportAttachment = Static<typeof SupportAttachment>;

export const SupportMessage = Type.Object({
  id: Type.String(),
  /** True for the person's messages, false for VoiceRoom's answers. */
  fromPerson: Type.Boolean(),
  body: Type.String(),
  createdAt: Nullable(Type.Number()),
  attachments: Type.Array(SupportAttachment),
  /** Who on staff sent an answer; null for the person's messages and unknown senders. */
  staffName: Nullable(Type.String())
});
export type SupportMessage = Static<typeof SupportMessage>;

export const SupportNote = Type.Object({
  id: Type.String(),
  body: Type.String(),
  createdAt: Type.Number(),
  authorName: Type.String()
});
export type SupportNote = Static<typeof SupportNote>;

/**
 * GET /api/admin/support/threads/:userId. Reading it changes nothing: staff
 * mark it read with POST …/read once they open it.
 */
export const SupportThread = Ok({
  person: SupportPerson,
  /** Answering is closed unless the person's account is active. */
  personState: SupportPersonState,
  official: SupportOfficial,
  status: SupportStatus,
  resolvedAt: Nullable(Type.Number()),
  /**
   * The person deleted the conversation (no message of theirs to VoiceRoom is
   * left): the notes and the status stay, answering is closed.
   */
  conversationDeleted: Type.Boolean(),
  messages: Type.Array(SupportMessage),
  notes: Type.Array(SupportNote)
});
export type SupportThread = Static<typeof SupportThread>;

export const SupportUserParams = Type.Object({ userId: Type.String() });
export const SupportAttachmentParams = Type.Object({ id: Type.String(), variant: Type.String() });

export const SupportTextBody = Type.Object({
  text: Type.String({ minLength: 1, maxLength: SUPPORT_TEXT_MAX_LENGTH })
});
export type SupportTextBody = Static<typeof SupportTextBody>;

/**
 * POST /api/admin/support/threads/:userId/read: staff have seen the person's
 * messages up to the newest one; `openUnread` is the menu badge after it.
 */
export const SupportRead = Ok({ openUnread: Type.Number() });
export type SupportRead = Static<typeof SupportRead>;

/** POST …/reply takes an optional Idempotency-Key header, so a retried answer is sent once. */
export const SupportReplied = Ok({ message: SupportMessage });
export type SupportReplied = Static<typeof SupportReplied>;

export const SupportNoted = Ok({ note: SupportNote });
export type SupportNoted = Static<typeof SupportNoted>;

/**
 * POST …/resolve. Refused with 409 `support_thread_changed` while the person
 * has a message staff have not marked read.
 */
export const SupportResolved = Ok({ status: SupportStatus, resolvedAt: Nullable(Type.Number()) });
export type SupportResolved = Static<typeof SupportResolved>;
