// The room chat served by /api/rooms/:roomId/chat: the latest-100 list the
// room link grants, sending (with structured content, mentions, replies,
// attachments and idempotency in one transaction), editing, deleting and
// marking the room read. Each call returns what happened; the route decides
// how it is spelled over HTTP. Checks run in the order the legacy handler ran
// them, so a request that fails two checks still gets the same answer.

import type pg from 'pg';
import crypto from 'node:crypto';
import type { Logger } from 'pino';
import { isReservedPeerId } from '@voice-room/shared/validation';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { avatarColorForPeerId } from '../../lib/room-store.ts';
import { tokensMatch } from '../../platform/crypto/tokens-match.ts';
import type { LiveRoom, PresencePeer } from '../rooms/room-views.ts';
import { cleanChatText, messageFingerprint, normalizeAttachmentIds } from './message-input.ts';
import { requireReplyTarget } from './reply-projector.ts';
import { publicChatMessage, type RoomChatMessage } from './room-chat-views.ts';

type DbClient = Pick<pg.PoolClient, 'query'> | null | undefined;

interface ChatAuthor {
  id: string;
  avatarAccent?: string | null;
  avatarKey?: string | null;
  avatarColorKey?: string | null;
  displayName?: string;
  login?: string;
}

interface AppendInput {
  createdAt: number;
  id: string;
  avatarColorKey: string;
  name: string;
  peerId: string;
  text: string;
  content: unknown;
  authorUserId: string | null;
  replyToMessageId: string | null;
  beforeUnitOfWork: ((client: DbClient) => Promise<{ replay: true; message: RoomChatMessage } | null>) | null;
  unitOfWork: ((client: DbClient, inserted: RoomChatMessage) => Promise<void>) | null;
}

export interface RoomMessages {
  listMessages(roomId: string, options: { limit: number }): Promise<RoomChatMessage[]>;
  appendMessage(roomId: string, input: AppendInput): Promise<RoomChatMessage | null>;
  getMessage(roomId: string, messageId: string): Promise<RoomChatMessage | null>;
  softDeleteMessage(roomId: string, messageId: string): Promise<unknown>;
  editMessage(roomId: string, messageId: string, text: string): Promise<RoomChatMessage | null>;
  markRoomChatRead(roomId: string, userId: string): Promise<number | null | undefined>;
}

interface Delivery {
  idempotency: {
    reserve(
      client: DbClient,
      input: Record<string, unknown>
    ): Promise<
      { kind: 'replay'; response: { body?: { message?: RoomChatMessage } } } | { kind: string; ledgerKey: string }
    >;
    complete(
      client: DbClient,
      key: string,
      result: { body: unknown; messageId: string; statusCode: number }
    ): Promise<unknown>;
  };
  outbox: { enqueue(client: DbClient, event: Record<string, unknown>): Promise<unknown> };
}

type Projection = (context: 'room', message: RoomChatMessage, options?: { roomId: string }) => Promise<RoomChatMessage>;

export interface RoomChatDeps {
  messages(): { room: RoomMessages };
  readService(): {
    advanceRoom(input: {
      cursor: string;
      roomId: string;
      userId: string;
    }): Promise<{ readThrough?: unknown; [key: string]: unknown }>;
  };
  getRoom(roomId: string): Promise<LiveRoom | null>;
  findRoomBan(roomId: string, userId: string | null | undefined, ip: string): Promise<unknown>;
  feature(name: 'engagement' | 'replies' | 'mediaUploads'): boolean;
  prepareContent(input: { content: unknown; text: string }): { content: unknown; text: string };
  mentionUserIds(
    content: unknown,
    options: { creatorUserId: string }
  ): { ok: true; userIds: string[] } | { ok: false; code: string };
  limiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
  findUser(userId: string): Promise<ChatAuthor | null>;
  media(): { attachments: { bindReady(input: Record<string, unknown>, client: DbClient): Promise<unknown> } } | null;
  replies(): {
    lockRoomTarget(input: {
      roomId: string;
      messageId: string;
      client: DbClient;
    }): Promise<{ authorUserId?: string | null } | null>;
  };
  notifications(): {
    service: {
      createAddressedForMessage(input: Record<string, unknown>): Promise<unknown>;
      markRoomRead?(input: { userId: string; roomId: string; through: unknown }): Promise<unknown>;
    };
  } | null;
  delivery(): Delivery | null;
  projectMedia: Projection;
  projectReply: Projection;
  identity: {
    chatPeerId(user: ChatAuthor | null): string;
    avatarColorKey(user: ChatAuthor | null): string;
    displayName(user: ChatAuthor | null): string;
  };
  directEmit: boolean;
  broadcastChatMessage(roomId: string, message: RoomChatMessage): void;
  broadcastRoomDetail(roomId: string, event: ServerEnvelope): void;
  roomDetailEvent(type: 'room.chat.deleted' | 'room.chat.edited', payload: Record<string, unknown>): ServerEnvelope;
  scheduleLinkPreview(roomId: string, messageId: string, text: string, options?: { edited?: boolean }): void;
  refreshPins(roomId: string, action: 'message-deleted' | 'message-edited', messageId: string): Promise<void>;
  sendRoomSummaryToUser(roomId: string, userId: string): Promise<void>;
  logger(): Pick<Logger, 'warn' | 'error'>;
}

export interface Caller {
  user: ChatAuthor | null;
  clientIp: string;
}

export interface PeerClaim {
  peerId: string;
  sessionToken: string;
}

export type ChatRefusal =
  | { status: 'room_not_found' }
  | { status: 'room_banned' }
  | { status: 'message_not_found' }
  | { status: 'invalid_session' }
  | { status: 'empty' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type PostOutcome =
  | { status: 'created'; message: RoomChatMessage }
  | ChatRefusal
  | {
      status:
        | 'structured_unavailable'
        | 'invalid_content'
        | 'invalid_attachments'
        | 'reply_unavailable'
        | 'presence_required'
        | 'media_unavailable';
    }
  | { status: 'invalid_mention'; code: string };

export interface PostInput extends Caller, PeerClaim {
  roomId: string;
  name: string;
  text: unknown;
  content: unknown;
  attachmentIds: unknown;
  replyTo: unknown;
  replyToMessageId: string;
  idempotencyKey: string;
}

export function createRoomChatService(deps: RoomChatDeps) {
  function rateLimited(clientIp: string, roomId: string): ChatRefusal | null {
    const rate = deps.limiter.check(`${clientIp}:${roomId}`);
    return rate.allowed ? null : { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds ?? 0 };
  }

  function isLivePeer(peer: PresencePeer | undefined, sessionToken: string): peer is PresencePeer {
    return Boolean(peer && tokensMatch(peer.sessionToken, sessionToken));
  }

  // The room link is the capability for guests, so this list stays readable to
  // anyone who can join, but not to someone the room has banned. Account
  // members use the paginated history route.
  async function list(
    roomId: string,
    caller: Caller
  ): Promise<{ status: 'listed'; messages: RoomChatMessage[] } | ChatRefusal> {
    const room = await deps.getRoom(roomId);
    if (!room) return { status: 'room_not_found' };
    if (await deps.findRoomBan(roomId, caller.user?.id, caller.clientIp)) return { status: 'room_banned' };
    const stored = await deps.messages().room.listMessages(roomId, { limit: 100 });
    const messages = await Promise.all(
      stored.map(async (message) => deps.projectReply('room', await deps.projectMedia('room', message), { roomId }))
    );
    return { status: 'listed', messages };
  }

  async function post(input: PostInput): Promise<PostOutcome> {
    const { roomId, clientIp, user: sessionUser } = input;
    const room = await deps.getRoom(roomId);
    let text = cleanChatText(input.text);
    let content: unknown;
    let mentionUserIds: string[] = [];
    if (input.content != null) {
      if (!deps.feature('engagement')) return { status: 'structured_unavailable' };
      try {
        const prepared = deps.prepareContent({ content: input.content, text });
        content = prepared.content;
        text = prepared.text;
        const mentions = deps.mentionUserIds(content, { creatorUserId: sessionUser?.id || '' });
        if (!mentions.ok) return { status: 'invalid_mention', code: mentions.code };
        mentionUserIds = mentions.userIds;
      } catch {
        return { status: 'invalid_content' };
      }
    }
    const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const { replyToMessageId, idempotencyKey } = input;

    if (!room) return { status: 'room_not_found' };
    if (await deps.findRoomBan(roomId, sessionUser?.id, clientIp)) return { status: 'room_banned' };
    if (attachmentIds === null) return { status: 'invalid_attachments' };
    if (input.replyTo != null && (!replyToMessageId || !deps.feature('replies')))
      return { status: 'reply_unavailable' };
    if (!text && attachmentIds.length === 0) return { status: 'empty' };
    const limited = rateLimited(clientIp, roomId);
    if (limited) return limited;

    // A requested peer id is only honoured when it is a live roster entry whose
    // session token matches. Anything else, including another guest's id or a
    // reserved `auth-` id, falls back to the caller's own account peer id, so
    // a message is never filed under an identity the caller does not hold.
    const requestedPeerId = input.peerId;
    const activePeer =
      requestedPeerId && !isReservedPeerId(requestedPeerId) ? (room.peers.get(requestedPeerId) ?? null) : null;
    let peerId = activePeer ? requestedPeerId : deps.identity.chatPeerId(sessionUser);
    let avatarColorKey: string = deps.identity.avatarColorKey(sessionUser) || (avatarColorForPeerId(peerId) as string);
    if (activePeer) {
      if (!isLivePeer(activePeer, input.sessionToken)) return { status: 'invalid_session' };
      if (await deps.findRoomBan(roomId, activePeer.accountUserId, activePeer.ip || clientIp))
        return { status: 'room_banned' };
      peerId = activePeer.id;
      if (deps.identity.avatarColorKey(sessionUser))
        activePeer.avatarColorKey = deps.identity.avatarColorKey(sessionUser);
      avatarColorKey = activePeer.avatarColorKey || (avatarColorForPeerId(peerId) as string);
    } else if (!sessionUser) {
      return { status: 'presence_required' };
    }

    let authorUser = sessionUser;
    if (!authorUser && activePeer?.accountUserId) {
      try {
        authorUser = await deps.findUser(activePeer.accountUserId);
      } catch (error) {
        deps
          .logger()
          .warn(
            { evt: LOG_EVENTS.MESSAGE_AUTHOR_PROFILE_FAILED, roomId, err: error },
            'failed to resolve a room chat author profile'
          );
      }
    }

    const name = deps.identity.displayName(authorUser) || activePeer?.name || input.name;
    const authorUserId = authorUser?.id || activePeer?.accountUserId || null;
    const avatarAccent = authorUser?.avatarAccent || activePeer?.avatarAccent || null;
    const avatarUrl = authorUser?.avatarKey
      ? `/api/avatars/${encodeURIComponent(authorUser.avatarKey)}`
      : activePeer?.avatarUrl || null;
    const media = attachmentIds.length > 0 ? deps.media() : null;
    if (attachmentIds.length > 0 && (!authorUserId || !media || !deps.feature('mediaUploads')))
      return { status: 'media_unavailable' };
    const replies = replyToMessageId ? deps.replies() : null;
    const notifications = deps.notifications();
    const delivery = deps.delivery();
    let idempotencyLedgerKey = '';
    let replyPreview: unknown;
    let replyTargetUserId: string | null = null;

    const message = await deps.messages().room.appendMessage(roomId, {
      createdAt: Date.now(),
      id: crypto.randomUUID(),
      avatarColorKey,
      name,
      peerId,
      text,
      content,
      authorUserId,
      replyToMessageId: replyToMessageId || null,
      beforeUnitOfWork:
        idempotencyKey && delivery
          ? async (client) => {
              const reservation = await delivery.idempotency.reserve(client, {
                actorType: authorUserId ? 'account' : 'guest',
                actorId: authorUserId || peerId,
                conversation: { type: 'room', id: roomId },
                key: idempotencyKey,
                fingerprint: messageFingerprint({ text, content, attachmentIds, replyToMessageId })
              });
              if (reservation.kind === 'replay') {
                return {
                  replay: true as const,
                  message: (reservation as { response: { body?: { message?: RoomChatMessage } } }).response.body
                    ?.message as RoomChatMessage
                };
              }
              idempotencyLedgerKey = (reservation as { ledgerKey: string }).ledgerKey;
              return null;
            }
          : null,
      unitOfWork:
        attachmentIds.length > 0 || replyToMessageId || mentionUserIds.length > 0 || delivery
          ? async (client, inserted) => {
              if (replies) {
                const target = await replies.lockRoomTarget({ roomId, messageId: replyToMessageId, client });
                replyPreview = await requireReplyTarget({ message: target, visibility: true });
                replyTargetUserId = target?.authorUserId || null;
              }
              if (media) {
                await media.attachments.bindReady(
                  { ownerId: authorUserId, context: 'room', messageId: inserted.id, attachmentIds },
                  client
                );
              }
              if (
                authorUserId &&
                notifications &&
                deps.feature('engagement') &&
                (mentionUserIds.length > 0 || replyTargetUserId)
              ) {
                await notifications.service.createAddressedForMessage({
                  roomId,
                  messageId: inserted.id,
                  creatorUserId: authorUserId,
                  targetUserIds: mentionUserIds,
                  replyTargetUserId,
                  body: text,
                  client
                });
              }
              if (delivery) {
                await delivery.outbox.enqueue(client, {
                  eventId: crypto.randomUUID(),
                  type: 'message.created',
                  conversation: { type: 'room', id: roomId },
                  messageId: inserted.id,
                  message: {
                    ...inserted,
                    name,
                    avatarAccent,
                    avatarColorKey,
                    avatarKey: authorUser?.avatarKey || null,
                    avatarUrl
                  }
                });
                if (idempotencyLedgerKey) {
                  await delivery.idempotency.complete(client, idempotencyLedgerKey, {
                    body: { message: inserted },
                    messageId: inserted.id,
                    statusCode: 201
                  });
                }
              }
            }
          : null
    });
    if (!message) return { status: 'empty' };

    const projectedBase = await deps.projectMedia('room', message);
    const projected = message.idempotencyReplay
      ? await deps.projectReply('room', projectedBase, { roomId })
      : { ...projectedBase, replyPreview };
    const published: RoomChatMessage = { ...projected, name, avatarAccent, avatarColorKey, avatarUrl };
    if (!message.idempotencyReplay) {
      if (deps.directEmit) deps.broadcastChatMessage(roomId, published);
      deps.scheduleLinkPreview(roomId, message.id, text);
    }
    return { status: 'created', message: published };
  }

  // Editing belongs to the author alone, even in a persistent room. Account
  // authorship is decided by the account: peer ids are client-chosen, and
  // matching them is how a guest could act on a signed-in author's messages.
  async function edit(
    input: Caller & PeerClaim & { roomId: string; messageId: string; text: unknown }
  ): Promise<
    { status: 'edited'; message: ReturnType<typeof publicChatMessage> } | ChatRefusal | { status: 'not_author' }
  > {
    const { roomId, messageId, clientIp, user } = input;
    const room = await deps.getRoom(roomId);
    if (!room) return { status: 'room_not_found' };
    if (await deps.findRoomBan(roomId, user?.id, clientIp)) return { status: 'room_banned' };
    const text = cleanChatText(input.text);
    if (!text) return { status: 'empty' };

    const current = await deps.messages().room.getMessage(roomId, messageId);
    if (!current) return { status: 'message_not_found' };
    const isAccountAuthor = Boolean(user && current.authorUserId && user.id === current.authorUserId);
    const isPeerAuthor = Boolean(!current.authorUserId && input.peerId && input.peerId === current.peerId);
    if (!isAccountAuthor) {
      // Deliberately no owner/moderator override: editing always belongs to
      // the original author, even in a persistent room.
      if (!isPeerAuthor) return { status: 'not_author' };
      const activePeer = room.peers.get(input.peerId);
      if (!isLivePeer(activePeer, input.sessionToken)) return { status: 'invalid_session' };
      if (await deps.findRoomBan(roomId, activePeer.accountUserId, activePeer.ip || clientIp))
        return { status: 'room_banned' };
    }
    const limited = rateLimited(clientIp, roomId);
    if (limited) return limited;

    const message = await deps.messages().room.editMessage(roomId, messageId, text);
    if (!message) return { status: 'message_not_found' };
    const publicMessage = publicChatMessage(message);
    deps.broadcastRoomDetail(roomId, deps.roomDetailEvent('room.chat.edited', { roomId, message: publicMessage }));
    await deps.refreshPins(roomId, 'message-edited', messageId);
    deps.scheduleLinkPreview(roomId, messageId, text, { edited: true });
    return { status: 'edited', message: publicMessage };
  }

  // A guest message belongs to the live peer session that wrote it, an
  // account message to that account, and the owner of a persistent room may
  // delete anything in it.
  async function remove(
    input: Caller & PeerClaim & { roomId: string; messageId: string }
  ): Promise<{ status: 'deleted' } | ChatRefusal | { status: 'not_allowed' }> {
    const { roomId, messageId, user } = input;
    const room = await deps.getRoom(roomId);
    if (!room) return { status: 'room_not_found' };
    const current = await deps.messages().room.getMessage(roomId, messageId);
    if (!current) return { status: 'message_not_found' };

    const isPeerAuthor = !current.authorUserId && Boolean(input.peerId) && input.peerId === current.peerId;
    const isAccountAuthor = Boolean(user && current.authorUserId && user.id === current.authorUserId);
    const isRoomOwner = Boolean(user && room.isStatic && room.ownerId === user.id);
    if (isPeerAuthor) {
      if (!isLivePeer(room.peers.get(input.peerId), input.sessionToken)) return { status: 'invalid_session' };
    } else if (!isAccountAuthor && !isRoomOwner) {
      return { status: 'not_allowed' };
    }

    if (!(await deps.messages().room.softDeleteMessage(roomId, messageId))) return { status: 'message_not_found' };
    // Voice peers and preview watchers both get it as a room-detail envelope:
    // the legacy peer broadcast treats unknown event names as failures.
    deps.broadcastRoomDetail(roomId, deps.roomDetailEvent('room.chat.deleted', { roomId, messageId }));
    await deps.refreshPins(roomId, 'message-deleted', messageId);
    return { status: 'deleted' };
  }

  /**
   * Reading a room's chat retires the notifications it produced. They are two
   * records of the same event, and leaving them apart meant the bell still
   * claimed unread mentions for messages already read, again after every
   * reload. Best-effort: a read that succeeded must not fail over this.
   */
  async function retireRoomNotifications(roomId: string, userId: string, through: unknown): Promise<void> {
    try {
      // No release-2.5 pool means no inbox to retire: a quiet no-op.
      const service = deps.notifications()?.service;
      if (typeof service?.markRoomRead !== 'function') return;
      await service.markRoomRead({ userId, roomId, through: through ?? null });
    } catch (error) {
      deps
        .logger()
        .error({ evt: LOG_EVENTS.NOTIFICATION_RETIRE_FAILED, err: error }, 'failed to retire room notifications');
    }
  }

  type ReadOutcome =
    | { status: 'read'; result: Record<string, unknown> }
    | { status: 'room_not_found' }
    | { status: 'invalid_cursor'; statusCode: number; code: string; error: string };

  // A cursor advances the durable read point; without one the legacy
  // wall-clock read marks everything up to now.
  async function markRead(roomId: string, userId: string, cursor: unknown): Promise<ReadOutcome> {
    if (typeof cursor === 'string' && cursor) {
      try {
        const result = await deps.readService().advanceRoom({ cursor, roomId, userId });
        await retireRoomNotifications(roomId, userId, result.readThrough);
        await deps.sendRoomSummaryToUser(roomId, userId);
        return { status: 'read', result };
      } catch (error) {
        const failure = error as { statusCode?: number; code?: string; message?: string };
        const code = failure.code || 'invalid_read_cursor';
        return {
          status: 'invalid_cursor',
          statusCode: failure.statusCode || 400,
          code,
          error: failure.message || code
        };
      }
    }

    const lastReadAt = await deps.messages().room.markRoomChatRead(roomId, userId);
    if (lastReadAt == null) return { status: 'room_not_found' };
    await retireRoomNotifications(roomId, userId, lastReadAt);
    await deps.sendRoomSummaryToUser(roomId, userId);
    return { status: 'read', result: { lastReadAt, unreadCount: 0 } };
  }

  return { list, post, edit, remove, markRead };
}

export type RoomChatService = ReturnType<typeof createRoomChatService>;
