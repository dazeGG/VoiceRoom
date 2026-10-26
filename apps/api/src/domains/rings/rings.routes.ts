import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { RingAnswer, RingCreateBody, RingIdParams, RingRespondBody } from '@voice-room/shared/contracts/rings';
import { Failure } from '@voice-room/shared/contracts/http';
import { normalizeRoomId } from '@voice-room/shared/validation';
import { cleanUuid } from '../messaging/message-input.ts';
import type { ApiContext } from '../../app/context.ts';
import type { RingService } from './ring.service.ts';
import { failure } from '../../platform/http/http-kit.ts';
export function registerRingRoutes(root: FastifyInstance, ctx: ApiContext, rings: RingService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const response = { 200: RingAnswer, '4xx': Failure };
  app.post('/api/rings', { schema: { body: RingCreateBody, response } }, async (request, reply) => {
    const me = await ctx.resolveSession(request.raw);
    if (!me?.user) return reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
    const roomId = normalizeRoomId(request.body.roomId),
      target = cleanUuid(request.body.userId);
    if (!roomId || !target || target === me.user.id)
      return reply.code(400).send(failure('Invalid ring target', { code: 'invalid_ring_target' }));
    const result = await rings.create(me.user, roomId, target, request.body.clientRequestId);
    switch (result.status) {
      case 'rung':
        return { ok: true as const, ring: result.ring };
      case 'request_conflict':
        return reply
          .code(409)
          .send(failure('Request key belongs to a different invitation', { code: 'idempotency_conflict' }));
      case 'rate_limited':
        return reply
          .code(429)
          .header('Retry-After', String(result.retryAfterSeconds))
          .send({
            ...failure('Invite cooldown', { code: 'invite_cooldown' }),
            retryAfterSeconds: result.retryAfterSeconds
          });
      case 'room_not_found':
        return reply.code(404).send(failure('Room not found', { code: 'room_not_found' }));
      case 'not_friends':
        return reply.code(403).send(failure('You are not friends', { code: 'not_friends' }));
      case 'blocked':
        return reply.code(403).send(failure('Invite is unavailable', { code: 'relationship_blocked' }));
      case 'account_deleted':
        return reply.code(403).send(failure('Invite is unavailable', { code: 'account_deleted' }));
    }
  });
  app.get('/api/rings/:ringId', { schema: { params: RingIdParams, response } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const me = await ctx.resolveSession(request.raw);
    if (!me?.user) return reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
    const ring = await rings.act(request.params.ringId, me.user.id, 'status', ctx.clientIp(request.raw));
    return ring ? { ok: true as const, ring } : reply.code(404).send(failure('Ring not found', { code: 'not_found' }));
  });
  app.post(
    '/api/rings/:ringId/respond',
    { schema: { params: RingIdParams, body: RingRespondBody, response } },
    async (request, reply) => {
      const me = await ctx.resolveSession(request.raw);
      if (!me?.user)
        return reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
      const ring = await rings.act(request.params.ringId, me.user.id, request.body.action, ctx.clientIp(request.raw));
      return ring
        ? { ok: true as const, ring }
        : reply.code(404).send(failure('Ring not found', { code: 'not_found' }));
    }
  );
  app.post('/api/rings/:ringId/cancel', { schema: { params: RingIdParams, response } }, async (request, reply) => {
    const me = await ctx.resolveSession(request.raw);
    if (!me?.user) return reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
    const ring = await rings.act(request.params.ringId, me.user.id, 'cancel', ctx.clientIp(request.raw));
    return ring ? { ok: true as const, ring } : reply.code(404).send(failure('Ring not found', { code: 'not_found' }));
  });
}
