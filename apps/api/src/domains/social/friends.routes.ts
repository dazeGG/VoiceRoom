// Friends, requests, blocks and ringing a friend into a room over HTTP.
// Texts and codes are the ones the web client shows.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeLogin, normalizeRoomId } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import { cleanUuid } from '../messaging/message-input.ts';
import type { FriendsService } from './friends.service.ts';
import type { SocialUser } from './social-views.ts';

const Answer = Type.Object({ ok: Type.Literal(true), status: Type.Optional(Type.String()), user: Type.Optional(Type.Unknown()) }, { additionalProperties: Type.Unknown() });
const Refusal = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.Optional(Type.String()),
  retryAfterSeconds: Type.Optional(Type.Number())
});
const Responses = { 200: Answer, 201: Answer, '4xx': Refusal };
const IdParams = Type.Object({ id: Type.String() });
const UserParams = Type.Object({ userId: Type.String() });
const REQUEST_NOT_FOUND = failure('Заявка не найдена');
const USER_NOT_FOUND = failure('Пользователь не найден');
const CANNOT_BLOCK = failure('Нельзя заблокировать этого пользователя');

export interface FriendsRoutesDeps {
  friends: FriendsService;
  requestLimiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
}

export function registerFriendsRoutes(root: FastifyInstance, ctx: ApiContext, { friends, requestLimiter }: FriendsRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<SocialUser | null> {
    const user = (await ctx.resolveSession(request.raw))?.user;
    if (user) return user as SocialUser;
    reply.code(401).send(failure('Требуется вход'));
    return null;
  }

  app.get('/api/friends', { schema: { response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, ...(await friends.list(user.id)) };
  });

  app.get('/api/friends/search', {
    schema: { querystring: Type.Object({ q: Type.Optional(Type.String()) }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, results: await friends.search(user.id, request.query.q || '') };
  });

  app.get('/api/friends/requests', { schema: { response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, ...(await friends.requests(user.id)) };
  });

  app.post('/api/friends/requests', {
    preValidation: optionalJsonBody,
    schema: {
      body: Type.Object({ userId: Type.Optional(Type.Unknown()), addresseeUserId: Type.Optional(Type.Unknown()), login: Type.Optional(Type.Unknown()), handle: Type.Optional(Type.Unknown()) }),
      response: Responses
    }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const rate = requestLimiter.check(user.id);
    if (!rate.allowed) {
      return reply.code(429).header('Retry-After', String(rate.retryAfterSeconds))
        .send({ ...failure('Слишком много заявок, попробуйте позже'), retryAfterSeconds: rate.retryAfterSeconds });
    }
    const { body } = request;
    const userId = cleanUuid(body.userId || body.addresseeUserId || '');
    const login: string = normalizeLogin(body.login || body.handle || '');
    if (!userId && !login) return reply.code(400).send(failure('Неверный пользователь'));

    const result = await friends.sendRequest(user, { userId, login });
    switch (result.status) {
      case 'not_found': return reply.code(404).send(USER_NOT_FOUND);
      case 'self': return reply.code(400).send(failure('Нельзя добавить себя'));
      case 'blocked': return reply.code(403).send(failure('Заявку отправить нельзя'));
      case 'sent': return reply.code(201).send({ ok: true as const, status: 'sent', user: result.user });
      default: return { ok: true as const, status: result.status, user: result.user };
    }
  });

  for (const action of ['accept', 'decline'] as const) {
    app.post(`/api/friends/requests/:id/${action}`, { schema: { params: IdParams, response: Responses } }, async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const id = cleanUuid((request.params as { id: string }).id);
      if (!id) return reply.code(404).send(REQUEST_NOT_FOUND);
      const result = await friends.respond(user, id, action);
      if (result.status === 'not_found') return reply.code(404).send(REQUEST_NOT_FOUND);
      if (result.status === 'blocked') return reply.code(409).send(failure('Заявка больше недоступна', { code: 'relationship_blocked' }));
      if (result.status === 'accepted') return { ok: true as const, status: 'accepted', user: result.user };
      return { ok: true as const, status: 'declined' };
    });
  }

  app.delete('/api/friends/requests/:id', { schema: { params: IdParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const id = cleanUuid(request.params.id);
    if (!id || (await friends.cancel(user.id, id)).status === 'not_found') return reply.code(404).send(REQUEST_NOT_FOUND);
    return { ok: true as const };
  });

  // Registered before /api/friends/:userId so the literal segment wins the match.
  app.get('/api/blocks', { schema: { response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, ...(await friends.blocked(user.id)) };
  });

  app.put('/api/blocks/:userId', { schema: { params: UserParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const id = cleanUuid(request.params.userId);
    if (!id || id === user.id) return reply.code(400).send(CANNOT_BLOCK);
    const result = await friends.block(user.id, id);
    if (result.status === 'not_found') return reply.code(404).send(USER_NOT_FOUND);
    if (result.status === 'invalid') return reply.code(400).send(CANNOT_BLOCK);
    return { ok: true as const, status: result.result };
  });

  app.delete('/api/blocks/:userId', { schema: { params: UserParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const id = cleanUuid(request.params.userId);
    if (!id) return reply.code(404).send(USER_NOT_FOUND);
    if ((await friends.unblock(user.id, id)).status === 'not_found') return reply.code(404).send(failure('Пользователь не заблокирован'));
    return { ok: true as const };
  });

  app.delete('/api/friends/:userId', { schema: { params: UserParams, response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const id = cleanUuid(request.params.userId);
    if (!id || (await friends.remove(user.id, id)).status === 'not_found') return reply.code(404).send(failure('Друг не найден'));
    return { ok: true as const };
  });

  app.post('/api/rooms/:roomId/ring', {
    preValidation: optionalJsonBody,
    schema: { params: Type.Object({ roomId: Type.String() }), body: Type.Object({ userId: Type.Optional(Type.Unknown()) }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const roomId: string = normalizeRoomId(request.params.roomId);
    const targetUserId = cleanUuid(request.body.userId);
    if (!roomId || !targetUserId || targetUserId === user.id) return reply.code(400).send(failure('Invalid ring target'));
    const result = await friends.ring(user, roomId, targetUserId);
    switch (result.status) {
      case 'not_friends': return reply.code(403).send(failure('You are not friends'));
      case 'blocked': return reply.code(403).send(failure('Invite is unavailable', { code: 'relationship_blocked' }));
      case 'account_deleted': return reply.code(403).send(failure('Invite is unavailable', { code: 'account_deleted' }));
      case 'rate_limited':
        return reply.code(429).header('Retry-After', String(result.retryAfterSeconds))
          .send({ ...failure('Invite cooldown'), retryAfterSeconds: result.retryAfterSeconds });
      case 'room_not_found': return reply.code(404).send(failure('Room not found'));
      case 'rung': return { ok: true as const };
    }
  });
}
