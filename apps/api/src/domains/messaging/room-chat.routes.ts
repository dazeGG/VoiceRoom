// The room chat over HTTP: list, send, edit, delete and mark read. Answers,
// texts and codes are the ones the web client already handles.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { RoomIdParams } from '@voice-room/shared/contracts/http';
import {
  DeleteRoomMessageBody,
  EditRoomMessageBody,
  MessageDeleted,
  MessageFailure,
  MessageParams,
  PostRoomMessageBody,
  ReadBody,
  RoomChat,
  RoomMessageAnswer,
  RoomRead
} from '@voice-room/shared/contracts/messages';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { cleanName, normalizePeerId, normalizeRoomId, normalizeSessionToken } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import { roomBanned } from '../rooms/room-views.ts';
import { cleanUuid, requestIdempotencyKey } from './message-input.ts';
import { publicChatMessage } from './room-chat-views.ts';
import type { Caller, ChatRefusal, PostOutcome, RoomChatService } from './room-chat.service.ts';

const Failures = { '4xx': MessageFailure, 503: MessageFailure };

type Refusal = ChatRefusal | Exclude<PostOutcome, { status: 'created' }> | { status: 'not_author' | 'not_allowed' };

function sendRefusal(reply: FastifyReply, roomId: string, refusal: Refusal) {
  switch (refusal.status) {
    case 'room_not_found':
      return reply.code(404).send({ ...failure('Room not found', { code: 'room_not_found' }), roomId });
    case 'room_banned':
      return reply.code(403).send(roomBanned(roomId));
    case 'message_not_found':
      return reply.code(404).send(failure('Message not found', { code: 'message_not_found' }));
    case 'invalid_session':
      return reply.code(403).send(failure('Invalid peer session', { code: 'invalid_session' }));
    case 'empty':
      return reply.code(400).send(failure('Invalid chat message', { code: 'invalid_message' }));
    case 'rate_limited':
      return reply
        .code(429)
        .header('Retry-After', String(refusal.retryAfterSeconds))
        .send({
          ...failure('Too many chat messages', { code: 'message_rate_limited' }),
          retryAfterSeconds: refusal.retryAfterSeconds
        });
    case 'not_author':
      return reply.code(403).send(failure('Not allowed to edit this message', { code: 'message_edit_forbidden' }));
    case 'not_allowed':
      return reply.code(403).send(failure('Not allowed to delete this message', { code: 'message_delete_forbidden' }));
    case 'structured_unavailable':
      return reply
        .code(409)
        .send(failure('Structured messages are unavailable', { code: 'structured_messages_unavailable' }));
    case 'invalid_mention':
      return reply.code(422).send(failure('Invalid mention target', { code: refusal.code }));
    case 'invalid_content':
      return reply.code(400).send(failure('Invalid message content', { code: 'invalid_message_content' }));
    case 'invalid_attachments':
      return reply.code(400).send(failure('Invalid attachments', { code: 'invalid_attachments' }));
    case 'reply_unavailable':
      return reply.code(409).send(failure('Reply target is unavailable', { code: 'reply_unavailable' }));
    case 'presence_required':
      return reply
        .code(403)
        .send(failure('Active room presence or login required', { code: 'presence_or_login_required' }));
    case 'media_unavailable':
      return reply.code(503).send(failure('Media uploads are unavailable', { code: 'media_uploads_disabled' }));
  }
}

export function registerRoomChatRoutes(root: FastifyInstance, ctx: ApiContext, chat: RoomChatService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function caller(raw: Parameters<ApiContext['resolveSession']>[0]): Promise<Caller> {
    const session = await ctx.resolveSession(raw);
    return { user: (session?.user ?? null) as Caller['user'], clientIp: ctx.clientIp(raw) };
  }

  app.get(
    '/api/rooms/:roomId/chat',
    {
      schema: {
        params: RoomIdParams,
        response: { 200: RoomChat, ...Failures }
      }
    },
    async (request, reply) => {
      const roomId: string = normalizeRoomId(request.params.roomId);
      const result = await chat.list(roomId, await caller(request.raw));
      if (result.status !== 'listed') return sendRefusal(reply, roomId, result);
      return { ok: true as const, messages: result.messages.map(publicChatMessage), roomId };
    }
  );

  app.post(
    '/api/rooms/:roomId/chat',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: RoomIdParams,
        body: PostRoomMessageBody,
        response: { 201: RoomMessageAnswer, ...Failures }
      }
    },
    async (request, reply) => {
      const roomId: string = normalizeRoomId(request.params.roomId);
      const { body } = request;
      const { replyTo } = body;
      const result = await chat.post({
        ...(await caller(request.raw)),
        roomId,
        peerId: normalizePeerId(body.peerId),
        sessionToken: normalizeSessionToken(body.sessionToken),
        name: cleanName(body.name),
        text: body.text,
        content: body.content,
        attachmentIds: body.attachmentIds,
        replyTo,
        replyToMessageId: replyTo == null ? '' : cleanUuid(replyTo?.messageId),
        idempotencyKey: requestIdempotencyKey(request.raw as { headers?: Record<string, unknown> }, body)
      });
      if (result.status !== 'created') return sendRefusal(reply, roomId, result);
      return reply.code(201).send({ ok: true as const, message: publicChatMessage(result.message) });
    }
  );

  app.patch(
    '/api/rooms/:roomId/chat/:messageId',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: MessageParams,
        body: EditRoomMessageBody,
        response: { 200: RoomMessageAnswer, ...Failures }
      }
    },
    async (request, reply) => {
      const roomId: string = normalizeRoomId(request.params.roomId);
      const result = await chat.edit({
        ...(await caller(request.raw)),
        roomId,
        messageId: request.params.messageId,
        peerId: normalizePeerId(request.body.peerId),
        sessionToken: normalizeSessionToken(request.body.sessionToken),
        text: request.body.text
      });
      if (result.status !== 'edited') return sendRefusal(reply, roomId, result);
      return { ok: true as const, message: result.message };
    }
  );

  app.delete(
    '/api/rooms/:roomId/chat/:messageId',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: MessageParams,
        body: DeleteRoomMessageBody,
        response: { 200: MessageDeleted, ...Failures }
      }
    },
    async (request, reply) => {
      const roomId: string = normalizeRoomId(request.params.roomId);
      const result = await chat.remove({
        ...(await caller(request.raw)),
        roomId,
        messageId: request.params.messageId,
        peerId: normalizePeerId(request.body.peerId),
        sessionToken: normalizeSessionToken(request.body.sessionToken)
      });
      if (result.status !== 'deleted') return sendRefusal(reply, roomId, result);
      return { ok: true as const, deleted: true as const };
    }
  );

  app.post(
    '/api/rooms/:roomId/read',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: RoomIdParams,
        body: ReadBody,
        response: { 200: RoomRead, ...Failures }
      }
    },
    async (request, reply) => {
      const userId = (await ctx.resolveSession(request.raw))?.user?.id;
      if (!userId) return reply.code(401).send(failure('Требуется вход', { code: 'authentication_required' }));
      const roomId: string = normalizeRoomId(request.params.roomId);
      if (!roomId) return reply.code(404).send(failure('Комната не найдена', { code: 'room_not_found' }));

      const result = await chat.markRead(roomId, userId, request.body.cursor);
      if (result.status === 'room_not_found')
        return reply.code(404).send(failure('Комната не найдена', { code: 'room_not_found' }));
      if (result.status === 'invalid_cursor')
        return reply.code(result.statusCode).send(failure(result.error, { code: result.code }));
      return { ok: true as const, ...result.result };
    }
  );
}
