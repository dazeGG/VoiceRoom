import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { RoomIdParams } from '@voice-room/shared/contracts/http';
import {
  MeetOwnerAuthorization,
  MeetOwnerExchangeBody,
  MeetRoomCreated,
  MeetRoomStatus,
  RoomFailure
} from '@voice-room/shared/contracts/rooms';
import { normalizeRoomId } from '@voice-room/shared/validation';
import type { RateCheck } from '../../lib/rate-limit.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { OwnerCapability } from './meet-owner.service.ts';
import type { LiveRoom } from './room-views.ts';
import { roomAllowsSurface, roomCapabilities } from './room-surface.policy.ts';
import type { RoomsService } from './rooms.service.ts';

interface MeetRouteDeps {
  owner: OwnerCapability;
  origin: string;
  createRoom: RoomsService['createRoom'];
  getRoom(roomId: string): Promise<LiveRoom | null>;
  createLimiter: RateCheck;
  maxRoomPeers: number;
}

export function registerMeetRoomRoutes(root: FastifyInstance, deps: MeetRouteDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.post(
    '/api/meet/owner/exchange',
    { schema: { body: MeetOwnerExchangeBody, response: { 200: MeetOwnerAuthorization, '4xx': RoomFailure } } },
    async (request, reply) => {
      const token = await deps.owner.exchangeLink(request.body.token);
      if (!token) return reply.code(401).send(failure('Invalid owner link', { code: 'invalid_credentials' }));
      return { ok: true as const, token };
    }
  );
  app.post(
    '/api/meet/rooms',
    { schema: { response: { 201: MeetRoomCreated, '4xx': RoomFailure, 503: RoomFailure } } },
    async (request, reply) => {
      const authorization = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
      if (!(await deps.owner.canCreate(authorization)))
        return reply.code(401).send(failure('Owner authorization required', { code: 'authentication_required' }));
      const rate = deps.createLimiter.check('meet-owner');
      if (!rate.allowed)
        return reply
          .code(429)
          .header('Retry-After', String(rate.retryAfterSeconds))
          .send(failure('Too many rooms created', { code: 'room_create_rate_limited' }));
      const created = await deps.createRoom({ kind: 'meet', creatorIp: '', isStatic: false, ownerId: null, name: '' });
      if (created.status === 'quota_exceeded')
        return reply.code(429).send(failure('Too many temporary rooms', { code: 'temporary_room_quota' }));
      if (created.status !== 'created')
        return reply.code(503).send(failure('Room capacity unavailable', { code: 'room_full' }));
      const roomId = created.room.id;
      return reply.code(201).send({ ok: true, roomId, joinUrl: new URL(`/room/${roomId}`, deps.origin).href });
    }
  );
  app.get(
    '/api/meet/rooms/:roomId/status',
    { schema: { params: RoomIdParams, response: { 200: MeetRoomStatus, '4xx': RoomFailure } } },
    async (request, reply) => {
      const room = await deps.getRoom(normalizeRoomId(request.params.roomId));
      if (!room || !roomAllowsSurface(room, 'meet'))
        return reply.code(404).send(failure('Room not found', { code: 'room_not_found' }));
      return {
        ok: true as const,
        roomId: room.id,
        capabilities: roomCapabilities('meet', deps.maxRoomPeers),
        peers: room.peers.size
      };
    }
  );
}
