import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  WidgetCreateRoomBody,
  WidgetCodeParams,
  WidgetRoomCreated,
  WidgetRoomInfo
} from '@voiceroom/shared/contracts/widget';
import { RoomFailure } from '@voiceroom/shared/contracts/rooms';
import { normalizeRoomId } from '@voiceroom/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { RoomRoutesDeps } from './rooms.routes.ts';
import { roomAllowsSurface, roomCapabilities } from './room-surface.policy.ts';

export function registerWidgetRoomRoutes(
  root: FastifyInstance,
  ctx: ApiContext,
  deps: Pick<RoomRoutesDeps, 'rooms' | 'getRoom' | 'createLimiter' | 'pow' | 'ipKeyOf' | 'maxRoomPeers'>
): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.post(
    '/api/widget/rooms',
    {
      schema: {
        body: WidgetCreateRoomBody,
        response: { 201: WidgetRoomCreated, '4xx': RoomFailure, 503: RoomFailure }
      }
    },
    async (request, reply) => {
      const ip = ctx.clientIp(request.raw);
      const rate = deps.createLimiter.check(ip);
      if (!rate.allowed)
        return reply
          .code(429)
          .header('Retry-After', String(rate.retryAfterSeconds))
          .send(failure('Too many rooms created', { code: 'room_create_rate_limited' }));
      const proof = deps.pow.verify(ip, request.body.proof);
      if (!proof.ok) return reply.code(proof.status).send(failure(proof.error, { code: proof.code }));
      const created = await deps.rooms.createRoom({
        creatorIp: deps.ipKeyOf(ip) ?? '',
        isStatic: false,
        ownerId: null,
        name: '',
        kind: 'widget',
        widgetChatEnabled: false
      });
      if (created.status === 'quota_exceeded')
        return reply.code(429).send(failure('Too many temporary rooms', { code: 'temporary_room_quota' }));
      if (created.status !== 'created')
        return reply.code(503).send(failure('Room capacity unavailable', { code: 'room_full' }));
      return reply.code(201).send({
        ok: true as const,
        roomId: created.room.id,
        chat: false,
        maxRoomPeers: deps.maxRoomPeers
      });
    }
  );
  app.get(
    '/api/widget/rooms/:code',
    { schema: { params: WidgetCodeParams, response: { 200: WidgetRoomInfo, '4xx': RoomFailure } } },
    async (request, reply) => {
      const room = await deps.getRoom(normalizeRoomId(request.params.code));
      if (!roomAllowsSurface(room, 'widget') || !room)
        return reply.code(404).send(failure('Room not found', { code: 'room_not_found' }));
      return {
        ok: true as const,
        roomId: room.id,
        capabilities: roomCapabilities('widget', deps.maxRoomPeers),
        chat: false,
        maxRoomPeers: deps.maxRoomPeers,
        peers: room.peers.size
      };
    }
  );
}
