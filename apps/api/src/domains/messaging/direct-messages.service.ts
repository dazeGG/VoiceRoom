// Direct messages between friends: the thread, sending (attachments,
// replies, delivery outbox and idempotency in one transaction), answering a
// room invitation, editing, deleting and marking read. Checks run in the
// order the legacy handlers ran them.

import type { AccountMessage } from '../../realtime/account-events.ts';
import type { DirectMessage as DirectMessageView } from '@voice-room/shared/contracts/messages';
import type { PublicUser } from '@voice-room/shared/contracts/users';
import { publicUser } from '../account/user-records.ts';
import { isStoredDirectMessage } from '../social/social-records.ts';
import { isActiveAccount, type SocialUser } from '../social/social-views.ts';
import { cleanMessageText, messageFingerprint, normalizeAttachmentIds } from './message-input.ts';
import { sendUnitOfWork, type DbClient, type SendDelivery } from './message-send.ts';
import type { DirectReplyTarget } from './reply.repository.ts';
import type { AttachmentRepository } from '../media/attachment.repository.ts';
import { isDirectSender } from './direct-message.policy.ts';
import {
  revokeAttachmentsOnDelete,
  type DeleteUnitOfWork,
  type CleanupJobs,
  type RevocableAttachments
} from '../media/attachment-revocation.service.ts';
import type { RateCheck } from '../../lib/rate-limit.ts';

type Status<T extends string> = T extends string ? { status: T } : never;
type RateLimited = { status: 'rate_limited'; retryAfterSeconds: number };

/** A direct message as the store reads it: the contract shape plus what stays server-side. */
export type DirectMessage = DirectMessageView & { idempotencyReplay?: boolean; deletedAt?: number | null };

export interface DirectMessageStore {
  listThread(input: { userId: string; peerId: string }): Promise<DirectMessage[]>;
  markRead(input: { userId: string; peerId: string }): Promise<{ count: number }>;
  sendMessage(input: {
    senderId: string;
    recipientId: string;
    body: string;
    replyToMessageId: string | null;
    beforeUnitOfWork: ((client: DbClient) => Promise<{ replay: true; message: DirectMessage } | null>) | null;
    unitOfWork: ((client: DbClient, inserted: DirectMessage) => Promise<void>) | null;
  }): Promise<DirectMessage>;
  getMessage(userId: string, peerId: string, messageId: string): Promise<DirectMessage | null>;
  respondInvite(input: {
    messageId: string;
    recipientId: string;
    status: 'accepted' | 'declined';
  }): Promise<DirectMessage | null>;
  softDeleteMessage(messageId: string, options?: { unitOfWork?: DeleteUnitOfWork | null }): Promise<unknown>;
  editMessage(input: {
    messageId: string;
    senderId: string;
    recipientId: string;
    body: string;
  }): Promise<DirectMessage | null>;
}

type Projection = (
  context: 'dm',
  message: DirectMessage,
  options?: { userId: string; peerId: string }
) => Promise<DirectMessage>;

export interface DirectMessagesDeps {
  messages(): { direct: DirectMessageStore };
  readService(): {
    advanceDm(input: { cursor: string; peerId: string; userId: string }): Promise<Record<string, unknown>>;
  };
  friends(): {
    areFriends(a: string, b: string): Promise<boolean>;
    isBlockedBetween(a: string, b: string): Promise<boolean>;
  };
  findUser(userId: string): Promise<SocialUser | null>;
  isDmMuted(userId: string, peerUserId: string): Promise<boolean>;
  roomExists(roomId: string): Promise<boolean>;
  expireRoomInvitations(senderId: string, roomId: string): Promise<unknown>;
  limiter: RateCheck;
  media(): {
    attachments: RevocableAttachments & {
      bindReady(input: Parameters<AttachmentRepository['bindReady']>[0], client: DbClient): Promise<unknown>;
    };
    jobs: CleanupJobs;
  } | null;
  replies(): {
    lockDirectTarget(input: {
      userId: string;
      peerId: string;
      messageId: string;
      client: DbClient;
    }): Promise<DirectReplyTarget | null>;
  };
  delivery(): SendDelivery | null;
  projectMedia: Projection;
  projectReply: Projection;
  directEmit: boolean;
  notifyUser(userId: string, event: AccountMessage): void;
  /** The recipient's notification and push, unless they muted the sender. */
  notifyRecipient(recipientId: string, sender: SocialUser, message: DirectMessage): Promise<unknown>;
  scheduleLinkPreview(input: {
    messageId: string;
    senderId: string;
    recipientId: string;
    text: string;
    edited?: boolean;
  }): void;
}

// Multiline like room chat, but up to 2000 characters and no line cap.
export function cleanDmText(value: unknown): string {
  return cleanMessageText(value, { maxChars: 2000 });
}

// The stored shape is stricter than the service's, so a message that passes it is one.
function isReplayedMessage(value: unknown): value is DirectMessage {
  return isStoredDirectMessage(value);
}

export interface SendInput {
  text: unknown;
  attachmentIds: unknown;
  replyTo: unknown;
  replyToMessageId: string;
  idempotencyKey: string;
}

export function createDirectMessagesService(deps: DirectMessagesDeps) {
  function rateLimited(userId: string): RateLimited | null {
    const rate = deps.limiter.check(userId);
    return rate.allowed ? null : { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds };
  }

  // Opening the thread clears the unread badge and lets the peer see the read.
  async function thread(
    user: SocialUser,
    peerId: string
  ): Promise<
    | { status: 'listed'; peer: PublicUser; messages: DirectMessage[]; muted: boolean }
    | Status<'not_friends' | 'user_not_found'>
  > {
    if (!(await deps.friends().areFriends(user.id, peerId))) return { status: 'not_friends' };
    const peer = await deps.findUser(peerId);
    if (!peer) return { status: 'user_not_found' };
    const stored = await deps.messages().direct.listThread({ userId: user.id, peerId });
    const messages = await Promise.all(
      stored.map(async (message) =>
        deps.projectReply('dm', await deps.projectMedia('dm', message), { userId: user.id, peerId })
      )
    );
    const read = await deps.messages().direct.markRead({ userId: user.id, peerId });
    if (read.count > 0) deps.notifyUser(peerId, { type: 'dm-read', userId: user.id });
    return { status: 'listed', peer: publicUser(peer), messages, muted: await deps.isDmMuted(user.id, peerId) };
  }

  async function send(
    sender: SocialUser,
    recipientId: string,
    input: SendInput
  ): Promise<
    | { status: 'sent'; message: DirectMessage }
    | RateLimited
    | Status<
        | 'not_friends'
        | 'blocked'
        | 'account_deleted'
        | 'invalid_attachments'
        | 'reply_unavailable'
        | 'empty'
        | 'media_unavailable'
      >
  > {
    const limited = rateLimited(sender.id);
    if (limited) return limited;
    if (!(await deps.friends().areFriends(sender.id, recipientId))) return { status: 'not_friends' };
    if (await deps.friends().isBlockedBetween(sender.id, recipientId)) return { status: 'blocked' };
    if (!isActiveAccount(await deps.findUser(recipientId))) return { status: 'account_deleted' };

    const text = cleanDmText(input.text);
    const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const { replyToMessageId, idempotencyKey } = input;
    if (attachmentIds === null) return { status: 'invalid_attachments' };
    if (input.replyTo != null && !replyToMessageId) return { status: 'reply_unavailable' };
    if (!text && attachmentIds.length === 0) return { status: 'empty' };

    const media = attachmentIds.length > 0 ? deps.media() : null;
    if (attachmentIds.length > 0 && !media) return { status: 'media_unavailable' };
    const replies = replyToMessageId ? deps.replies() : null;
    const send = sendUnitOfWork({
      delivery: deps.delivery(),
      idempotencyKey,
      actor: { type: 'account', id: sender.id },
      conversation: { type: 'dm', id: recipientId },
      fingerprint: messageFingerprint({ text, attachmentIds, replyToMessageId }),
      isStored: isReplayedMessage,
      replayMissing: 'The idempotent replay holds no direct message',
      lockReply: replies
        ? (client) =>
            replies.lockDirectTarget({ userId: sender.id, peerId: recipientId, messageId: replyToMessageId, client })
        : null,
      bindAttachments: media
        ? (client, inserted) =>
            media.attachments.bindReady(
              { ownerId: sender.id, context: 'dm', messageId: inserted.id, attachmentIds },
              client
            )
        : null,
      afterInsert: null,
      outboxMessage: (inserted) => inserted
    });

    const stored = await deps.messages().direct.sendMessage({
      senderId: sender.id,
      recipientId,
      body: text,
      replyToMessageId: replyToMessageId || null,
      beforeUnitOfWork: send.beforeUnitOfWork,
      unitOfWork: send.unitOfWork
    });
    const projectedBase = await deps.projectMedia('dm', stored);
    const message = stored.idempotencyReplay
      ? await deps.projectReply('dm', projectedBase, { userId: sender.id, peerId: recipientId })
      : { ...projectedBase, replyPreview: send.replyPreview() };
    if (!stored.idempotencyReplay) {
      // To the recipient and the sender's other tabs; clients dedupe by id.
      if (deps.directEmit) {
        deps.notifyUser(recipientId, { type: 'dm-message', message });
        await deps.notifyRecipient(recipientId, sender, message);
        deps.notifyUser(sender.id, { type: 'dm-message', message });
      }
      deps.scheduleLinkPreview({ messageId: stored.id, senderId: sender.id, recipientId, text });
    }
    return { status: 'sent', message };
  }

  // The invited recipient accepts or declines a room invitation stored as a
  // DM; the updated message fans out as an edit so both timelines converge.
  async function respondInvite(
    user: SocialUser,
    peerId: string,
    messageId: string,
    action: 'accepted' | 'declined'
  ): Promise<
    | { status: 'answered'; message: DirectMessage }
    | Status<'not_found' | 'not_invited' | 'room_gone' | 'already_answered'>
  > {
    const current = await deps.messages().direct.getMessage(user.id, peerId, messageId);
    if (!current || !current.invite) return { status: 'not_found' };
    if (current.recipientId !== user.id) return { status: 'not_invited' };
    if (action === 'accepted' && !(await deps.roomExists(current.invite.roomId))) {
      await deps.expireRoomInvitations(current.senderId, current.invite.roomId);
      return { status: 'room_gone' };
    }
    const message = await deps.messages().direct.respondInvite({ messageId, recipientId: user.id, status: action });
    if (!message) return { status: 'already_answered' };
    const event: AccountMessage = { type: 'dm.message.edited', message };
    deps.notifyUser(peerId, event);
    deps.notifyUser(user.id, event);
    return { status: 'answered', message };
  }

  // A cursor advances the durable read point; without one everything up to
  // now is read. A refused cursor throws a MessageReadError that carries its
  // own status and code; any other failure is a server error. Both reach the
  // central error handler unchanged.
  async function markRead(
    userId: string,
    peerId: string,
    cursor: unknown
  ): Promise<{ status: 'read'; result: Record<string, unknown> }> {
    if (typeof cursor === 'string' && cursor) {
      const result = await deps.readService().advanceDm({ cursor, peerId, userId });
      deps.notifyUser(peerId, { type: 'dm-read', userId });
      return { status: 'read', result };
    }
    const result = await deps.messages().direct.markRead({ userId, peerId });
    if (result.count > 0) deps.notifyUser(peerId, { type: 'dm-read', userId });
    return { status: 'read', result: { count: result.count } };
  }

  // A deleted message takes its attachments with it, so their files are
  // cleaned up and stop counting toward the sender's quota.
  function softDelete(messageId: string): Promise<unknown> {
    return deps.messages().direct.softDeleteMessage(messageId, {
      unitOfWork: revokeAttachmentsOnDelete(deps.media(), 'dm', messageId)
    });
  }

  // Only the sender deletes, and it is gone for both sides. Each side indexes
  // the event by the other participant's id.
  async function remove(
    userId: string,
    peerId: string,
    messageId: string
  ): Promise<Status<'deleted' | 'not_found' | 'not_sender'>> {
    const current = await deps.messages().direct.getMessage(userId, peerId, messageId);
    if (!current) return { status: 'not_found' };
    if (!isDirectSender(current, userId)) return { status: 'not_sender' };
    if (!(await softDelete(messageId))) return { status: 'not_found' };
    deps.notifyUser(peerId, { type: 'dm.message.deleted', messageId, peerUserId: userId });
    deps.notifyUser(userId, { type: 'dm.message.deleted', messageId, peerUserId: peerId });
    return { status: 'deleted' };
  }

  // The service operator removes a reported message; the caller has already
  // checked the platform administrator. Both sides see it go like a deletion
  // by the sender.
  async function removeAsOperator({
    senderId,
    recipientId,
    messageId
  }: {
    senderId: string;
    recipientId: string;
    messageId: string;
  }): Promise<Status<'deleted' | 'not_found'>> {
    const current = await deps.messages().direct.getMessage(senderId, recipientId, messageId);
    if (!current || !isDirectSender(current, senderId)) return { status: 'not_found' };
    if (!(await softDelete(messageId))) return { status: 'not_found' };
    deps.notifyUser(recipientId, { type: 'dm.message.deleted', messageId, peerUserId: senderId });
    deps.notifyUser(senderId, { type: 'dm.message.deleted', messageId, peerUserId: recipientId });
    return { status: 'deleted' };
  }

  async function edit(
    userId: string,
    peerId: string,
    messageId: string,
    rawText: unknown
  ): Promise<
    | { status: 'edited'; message: DirectMessage }
    | RateLimited
    | Status<'empty' | 'not_found' | 'not_sender' | 'invitation'>
  > {
    const text = cleanDmText(rawText);
    if (!text) return { status: 'empty' };
    const current = await deps.messages().direct.getMessage(userId, peerId, messageId);
    if (!current) return { status: 'not_found' };
    if (!isDirectSender(current, userId)) return { status: 'not_sender' };
    if (current.invite) return { status: 'invitation' };
    const limited = rateLimited(userId);
    if (limited) return limited;
    const message = await deps
      .messages()
      .direct.editMessage({ messageId, senderId: userId, recipientId: peerId, body: text });
    if (!message) return { status: 'not_found' };
    deps.scheduleLinkPreview({ messageId, senderId: userId, recipientId: peerId, text, edited: true });
    const event: AccountMessage = { type: 'dm.message.edited', message };
    deps.notifyUser(peerId, event);
    deps.notifyUser(userId, event);
    return { status: 'edited', message };
  }

  return { thread, send, respondInvite, markRead, remove, removeAsOperator, edit };
}

export type DirectMessagesService = ReturnType<typeof createDirectMessagesService>;
