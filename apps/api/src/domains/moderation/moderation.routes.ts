// The room owner's moderation centre over HTTP: active bans, banning and
// unbanning, and deleting any message in the room.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import {
  BanBody,
  BanHeaders,
  BanLifted,
  BanPage,
  BanSaved,
  BansQuery,
  MessageRemoved,
  ModeratedMessageParams
} from '@voice-room/shared/contracts/moderation';
import { BanParams } from '@voice-room/shared/contracts/rooms';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { MessageModerationService } from './message-moderation.service.ts';
import type { ModerationService } from './moderation.service.ts';

const NOT_FOUND = failure('Not found', { code: 'not_found' });
const SIGN_IN_REQUIRED = failure('Authentication required', { code: 'authentication_required' });
const OWNER_REQUIRED = failure('Owner access required', { code: 'owner_required' });

export interface ModerationRoutesDeps {
  moderation: Pick<ModerationService, 'listActive' | 'putBan' | 'unban'>;
  messages: Pick<MessageModerationService, 'deleteRoomMessage'>;
  /** The moderation centre is behind a capability flag until it is on everywhere. */
  enabled(): boolean;
}

export function registerModerationRoutes(root: FastifyInstance, ctx: ApiContext, deps: ModerationRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    if (!deps.enabled()) {
      reply.code(404).send(NOT_FOUND);
      return null;
    }
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(SIGN_IN_REQUIRED);
    return null;
  }

  app.get(
    '/api/rooms/:roomId/moderation/bans',
    { schema: { params: RoomIdParams, querystring: BansQuery, response: { 200: BanPage, '4xx': Failure } } },
    async (request, reply) => {
      const actorUserId = await actor(request, reply);
      if (!actorUserId) return reply;
      try {
        const result = await deps.moderation.listActive({
          roomId: request.params.roomId,
          actorUserId,
          query: request.query
        });
        if (result.status === 'forbidden') return reply.code(403).send(OWNER_REQUIRED);
        return result.envelope;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'invalid_cursor')
          return reply.code(400).send(failure('Invalid cursor', { code: 'invalid_cursor' }));
        throw error;
      }
    }
  );

  app.put(
    '/api/rooms/:roomId/moderation/bans',
    {
      schema: {
        params: RoomIdParams,
        headers: BanHeaders,
        body: BanBody,
        response: { 200: BanSaved, 201: BanSaved, '4xx': Failure, 503: Failure }
      }
    },
    async (request, reply) => {
      const actorUserId = await actor(request, reply);
      if (!actorUserId) return reply;
      const result = await deps.moderation.putBan({
        roomId: request.params.roomId,
        actorUserId,
        input: request.body,
        idempotencyKey: request.headers['idempotency-key']
      });
      switch (result.status) {
        case 'invalid':
          return reply.code(400).send(failure('Invalid ban request', { code: 'invalid_request' }));
        case 'forbidden':
          return reply.code(403).send(OWNER_REQUIRED);
        case 'cap_exceeded':
          return reply.code(409).send(failure('Active ban limit reached', { code: 'room_ban_limit' }));
        case 'revocation_unavailable':
          return reply
            .code(503)
            .send(failure('Credential revocation unavailable', { code: 'credential_revoke_unavailable' }));
        case 'created':
        case 'updated':
        case 'replayed':
          return reply
            .code(result.status === 'created' ? 201 : 200)
            .send({ contractVersion: 1 as const, status: result.status, ban: result.ban });
      }
    }
  );

  app.delete(
    '/api/rooms/:roomId/moderation/bans/:banId',
    { schema: { params: BanParams, response: { 200: BanLifted, '4xx': Failure } } },
    async (request, reply) => {
      const actorUserId = await actor(request, reply);
      if (!actorUserId) return reply;
      const result = await deps.moderation.unban({
        roomId: request.params.roomId,
        actorUserId,
        banId: request.params.banId
      });
      if (result.status === 'invalid')
        return reply.code(400).send(failure('Invalid unban request', { code: 'invalid_request' }));
      if (result.status === 'forbidden') return reply.code(403).send(OWNER_REQUIRED);
      if (result.status === 'not_found')
        return reply.code(404).send(failure('Ban not found', { code: 'ban_not_found' }));
      return { contractVersion: 1 as const, status: 'unbanned' as const, ban: result.ban };
    }
  );

  app.delete(
    '/api/rooms/:roomId/moderation/messages/:messageId',
    { schema: { params: ModeratedMessageParams, response: { 200: MessageRemoved, '4xx': Failure } } },
    async (request, reply) => {
      const actorUserId = await actor(request, reply);
      if (!actorUserId) return reply;
      const result = await deps.messages.deleteRoomMessage({
        roomId: request.params.roomId,
        messageId: request.params.messageId,
        actorUserId
      });
      if (!result.deletion) {
        if (result.status === 'invalid')
          return reply.code(400).send(failure('Invalid message deletion', { code: 'invalid_request' }));
        if (result.status === 'forbidden') return reply.code(403).send(OWNER_REQUIRED);
        return reply.code(404).send(failure('Message not found', { code: 'message_not_found' }));
      }
      return { contractVersion: 1 as const, status: result.status, deletion: result.deletion };
    }
  );
}
