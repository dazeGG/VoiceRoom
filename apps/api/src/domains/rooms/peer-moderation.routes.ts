// The room owner's participant menu: kick, server mute, ban and undoing a ban.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Done, RoomIdParams } from '@voice-room/shared/contracts/http';
import {
  BanParams,
  PeerBanned,
  PeerTargetBody,
  RoomFailure,
  ServerMuteBody,
  ServerMuted
} from '@voice-room/shared/contracts/rooms';
import type { FastifyInstance } from 'fastify';
import { normalizePeerId, normalizeRoomId } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import type { PeerModerationService } from './peer-moderation.service.ts';
import { ownerRefusal } from './rooms.routes.ts';
import type { RoomsService } from './rooms.service.ts';

const PEER_NOT_FOUND = failure('Участник не найден', { code: 'peer_not_found' });
const MUTE_UNSUPPORTED = failure('Участник не поддерживает модерацию микрофона', { code: 'server_mute_unsupported' });
const BAN_NOT_SAVED = failure('Не удалось сохранить блокировку', { code: 'block_failed' });
const GATE_REVOKE_FAILED = 'Не удалось отозвать доступ участника';

export function registerPeerModerationRoutes(
  root: FastifyInstance,
  ctx: ApiContext,
  { rooms, moderation }: { rooms: RoomsService; moderation: PeerModerationService }
): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  // Resolves the owned room or answers 401/403/404 itself.
  async function ownedRoom(
    request: { raw: Parameters<ApiContext['resolveSession']>[0]; params: { roomId: string } },
    reply: { code(status: number): { send(body: unknown): unknown } }
  ) {
    const userId = (await ctx.resolveSession(request.raw))?.user?.id ?? null;
    const check = await rooms.checkOwner(userId, normalizeRoomId(request.params.roomId));
    if (check.status === 'owner') return check.room;
    const refusal = ownerRefusal(check);
    reply.code(refusal.status).send(refusal.body);
    return null;
  }

  app.post(
    '/api/rooms/:roomId/kick',
    {
      preValidation: optionalJsonBody,
      schema: { params: RoomIdParams, body: PeerTargetBody, response: { 200: Done, '4xx': RoomFailure } }
    },
    async (request, reply) => {
      const room = await ownedRoom(request, reply);
      if (!room) return reply;
      const result = await moderation.kick(room, normalizePeerId(request.body.peerId));
      if (result.status === 'peer_not_found') return reply.code(404).send(PEER_NOT_FOUND);
      if (result.status === 'owner')
        return reply.code(400).send(failure('Нельзя исключить владельца комнаты', { code: 'cannot_kick_owner' }));
      return { ok: true as const };
    }
  );

  // `muted` picks the direction so the menu can toggle without tracking which
  // endpoint to call; anything but an explicit false mutes.
  app.post(
    '/api/rooms/:roomId/server-mute',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: RoomIdParams,
        body: ServerMuteBody,
        response: { 200: ServerMuted, '4xx': RoomFailure }
      }
    },
    async (request, reply) => {
      const room = await ownedRoom(request, reply);
      if (!room) return reply;
      const result = await moderation.setServerMute(
        room,
        normalizePeerId(request.body.peerId),
        request.body.muted !== false
      );
      if (result.status === 'peer_not_found') return reply.code(404).send(PEER_NOT_FOUND);
      if (result.status === 'owner')
        return reply
          .code(400)
          .send(failure('Нельзя выключить микрофон владельцу комнаты', { code: 'cannot_mute_owner' }));
      if (result.status !== 'applied') return reply.code(400).send(MUTE_UNSUPPORTED);
      return { ok: true as const, muted: result.muted };
    }
  );

  app.post(
    '/api/rooms/:roomId/ban',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: RoomIdParams,
        body: PeerTargetBody,
        response: { 201: PeerBanned, '4xx': RoomFailure, 500: RoomFailure }
      }
    },
    async (request, reply) => {
      const room = await ownedRoom(request, reply);
      if (!room) return reply;
      const result = await moderation.ban(room, normalizePeerId(request.body.peerId));
      switch (result.status) {
        case 'peer_not_found':
          return reply.code(404).send(PEER_NOT_FOUND);
        case 'owner':
          return reply.code(400).send(failure('Нельзя заблокировать владельца комнаты', { code: 'cannot_ban_owner' }));
        case 'ban_limit':
          return reply.code(409).send(failure('Достигнут лимит блокировок комнаты', { code: 'room_ban_limit' }));
        case 'ban_rejected':
          return reply.code(409).send(BAN_NOT_SAVED);
        case 'ban_failed':
          return reply.code(500).send(BAN_NOT_SAVED);
        case 'principal_missing':
          return reply.code(500).send(failure(GATE_REVOKE_FAILED, { code: 'livekit_gate_principal_missing' }));
        case 'revoke_unavailable':
          return reply.code(500).send(failure(GATE_REVOKE_FAILED, { code: 'livekit_gate_revoke_unavailable' }));
        case 'banned':
          if (result.cleanupFailed)
            request.log.warn({ code: 'room_ban_peer_cleanup_failed' }, 'Banned peer cleanup finished with errors');
          return reply.code(201).send({ ok: true as const, banId: result.banId });
      }
    }
  );

  app.delete(
    '/api/rooms/:roomId/bans/:banId',
    {
      schema: {
        params: BanParams,
        response: { 200: Done, '4xx': RoomFailure }
      }
    },
    async (request, reply) => {
      const room = await ownedRoom(request, reply);
      if (!room) return reply;
      const result = await moderation.undoBan(room.id, request.params.banId);
      if (result.status === 'not_found')
        return reply.code(404).send(failure('Блокировка не найдена', { code: 'ban_not_found' }));
      return { ok: true as const };
    }
  );
}
