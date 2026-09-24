// Direct messages over HTTP. Texts and codes are the ones the web client shows.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import type { SocialUser } from '../social/social-views.ts';
import type { DirectMessagesService } from './direct-messages.service.ts';
import { cleanUuid, requestIdempotencyKey } from './message-input.ts';

const Answer = Type.Object({ ok: Type.Literal(true), message: Type.Optional(Type.Unknown()) }, { additionalProperties: Type.Unknown() });
const Refusal = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.Optional(Type.String()),
  retryAfterSeconds: Type.Optional(Type.Number())
});
const Responses = { 200: Answer, 201: Answer, '4xx': Refusal, 503: Refusal };
const UserParams = Type.Object({ userId: Type.String() });
const MessageParams = Type.Object({ userId: Type.String(), messageId: Type.String() });
const THREAD_NOT_FOUND = failure('Диалог не найден');
const MESSAGE_NOT_FOUND = failure('Сообщение не найдено');
const EMPTY_MESSAGE = failure('Пустое сообщение');
const NOT_FRIENDS = failure('Вы не друзья');

function tooMany(reply: FastifyReply, retryAfterSeconds: number) {
  return reply.code(429).header('Retry-After', String(retryAfterSeconds))
    .send({ ...failure('Слишком много сообщений, попробуйте позже'), retryAfterSeconds });
}

export function registerDirectMessageRoutes(root: FastifyInstance, ctx: ApiContext, dms: DirectMessagesService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<SocialUser | null> {
    const user = (await ctx.resolveSession(request.raw))?.user;
    if (user) return user as SocialUser;
    reply.code(401).send(failure('Требуется вход'));
    return null;
  }

  app.get('/api/dm/:userId', { schema: { params: UserParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId || peerId === user.id) return reply.code(404).send(THREAD_NOT_FOUND);
    const result = await dms.thread(user, peerId);
    if (result.status === 'not_friends') return reply.code(403).send(NOT_FRIENDS);
    if (result.status === 'user_not_found') return reply.code(404).send(failure('Пользователь не найден'));
    return { ok: true as const, peer: result.peer, messages: result.messages, muted: result.muted };
  });

  app.post('/api/dm/:userId', {
    preValidation: optionalJsonBody,
    schema: {
      params: UserParams,
      body: Type.Object({
        text: Type.Optional(Type.Unknown()),
        attachmentIds: Type.Optional(Type.Unknown()),
        replyTo: Type.Optional(Type.Unknown()),
        idempotencyKey: Type.Optional(Type.Unknown())
      }),
      response: Responses
    }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const recipientId = cleanUuid(request.params.userId);
    if (!recipientId || recipientId === user.id) return reply.code(404).send(THREAD_NOT_FOUND);
    const { body } = request;
    const replyTo = body.replyTo as { messageId?: unknown } | null | undefined;
    const result = await dms.send(user, recipientId, {
      text: body.text,
      attachmentIds: body.attachmentIds,
      replyTo,
      replyToMessageId: replyTo == null ? '' : cleanUuid(replyTo?.messageId),
      idempotencyKey: requestIdempotencyKey(request.raw as { headers?: Record<string, unknown> }, body)
    });
    switch (result.status) {
      case 'rate_limited': return tooMany(reply, result.retryAfterSeconds);
      case 'not_friends': return reply.code(403).send(NOT_FRIENDS);
      case 'blocked': return reply.code(403).send(failure('Сообщение недоступно', { code: 'relationship_blocked' }));
      case 'account_deleted': return reply.code(403).send(failure('Аккаунт удалён', { code: 'account_deleted' }));
      case 'invalid_attachments': return reply.code(400).send(failure('Invalid attachments'));
      case 'reply_unavailable': return reply.code(409).send(failure('Reply target is unavailable'));
      case 'empty': return reply.code(400).send(EMPTY_MESSAGE);
      case 'media_unavailable': return reply.code(503).send(failure('Media uploads are unavailable'));
      case 'sent': return reply.code(201).send({ ok: true as const, message: result.message });
    }
  });

  app.post('/api/dm/:userId/invites/:messageId/respond', {
    preValidation: optionalJsonBody,
    schema: { params: MessageParams, body: Type.Object({ action: Type.Optional(Type.Unknown()) }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId) return reply.code(404).send(THREAD_NOT_FOUND);
    const { action: requested } = request.body;
    const action = requested === 'accept' ? 'accepted' : requested === 'decline' ? 'declined' : null;
    if (!action) return reply.code(400).send(failure('Неверное действие'));
    const result = await dms.respondInvite(user, peerId, request.params.messageId, action);
    switch (result.status) {
      case 'not_found': return reply.code(404).send(failure('Приглашение не найдено'));
      case 'not_invited': return reply.code(403).send(failure('Отвечать может только приглашённый'));
      case 'room_gone': return reply.code(410).send(failure('Комната больше не существует'));
      case 'already_answered': return reply.code(409).send(failure('Приглашение уже обработано'));
      case 'answered': return { ok: true as const, message: result.message };
    }
  });

  app.post('/api/dm/:userId/read', {
    preValidation: optionalJsonBody,
    schema: { params: UserParams, body: Type.Object({ cursor: Type.Optional(Type.Unknown()) }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId) return reply.code(404).send(THREAD_NOT_FOUND);
    const result = await dms.markRead(user.id, peerId, request.body.cursor);
    if (result.status === 'invalid_cursor') return reply.code(result.statusCode).send(failure(result.error, { code: result.code }));
    return { ok: true as const, ...result.result };
  });

  app.patch('/api/dm/:userId/messages/:messageId', {
    preValidation: optionalJsonBody,
    schema: { params: MessageParams, body: Type.Object({ text: Type.Optional(Type.Unknown()) }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId) return reply.code(404).send(THREAD_NOT_FOUND);
    const result = await dms.edit(user.id, peerId, request.params.messageId, request.body.text);
    switch (result.status) {
      case 'empty': return reply.code(400).send(EMPTY_MESSAGE);
      case 'not_found': return reply.code(404).send(MESSAGE_NOT_FOUND);
      case 'not_sender': return reply.code(403).send(failure('Можно редактировать только свои сообщения'));
      case 'invitation': return reply.code(403).send(failure('Приглашение нельзя редактировать'));
      case 'rate_limited': return tooMany(reply, result.retryAfterSeconds);
      case 'edited': return { ok: true as const, message: result.message };
    }
  });

  app.delete('/api/dm/:userId/messages/:messageId', { schema: { params: MessageParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId) return reply.code(404).send(THREAD_NOT_FOUND);
    const result = await dms.remove(user.id, peerId, request.params.messageId);
    if (result.status === 'not_found') return reply.code(404).send(MESSAGE_NOT_FOUND);
    if (result.status === 'not_sender') return reply.code(403).send(failure('Можно удалять только свои сообщения'));
    return { ok: true as const, deleted: true };
  });
}
