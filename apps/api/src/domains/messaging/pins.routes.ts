// Pinned room messages over HTTP. Reading needs the room's chat; pinning and
// unpinning need to be able to react in the room. Every answer is the whole
// list of pins.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import { MessageParams, PinList } from '@voice-room/shared/contracts/messages';
import type { ApiContext, SessionUser } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { PinService } from './pin.service.ts';

export interface PinRoutesDeps {
  pins: Pick<PinService, 'list' | 'pin' | 'unpin'>;
  canRead(roomId: string, userId: string): Promise<boolean>;
  canWrite(roomId: string, userId: string): Promise<boolean>;
}

const answers = { 200: PinList, '4xx': Failure, '5xx': Failure };

export function registerPinRoutes(root: FastifyInstance, ctx: ApiContext, deps: PinRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  // A failure the services do not classify answers with the domain's own code.
  const config = { errorFallback: 'pin_error' as const };

  async function member(
    request: FastifyRequest,
    reply: FastifyReply,
    roomId: string,
    action: 'read' | 'write'
  ): Promise<SessionUser | null> {
    const user = (await ctx.resolveSession(request.raw))?.user ?? null;
    const allowed = user
      ? await (action === 'write' ? deps.canWrite(roomId, user.id) : deps.canRead(roomId, user.id))
      : false;
    if (user && allowed) return user;
    reply.code(user ? 403 : 401).send(failure('Room is not available', { code: 'room_forbidden' }));
    return null;
  }

  app.get(
    '/api/rooms/:roomId/pins',
    { config, schema: { params: RoomIdParams, response: answers } },
    async (request, reply) => {
      const roomId = request.params.roomId.trim();
      if (!(await member(request, reply, roomId, 'read'))) return reply;
      return { ok: true as const, ...(await deps.pins.list({ roomId })) };
    }
  );

  for (const [method, change] of [
    ['PUT', 'pin'],
    ['DELETE', 'unpin']
  ] as const) {
    app.route({
      method,
      url: '/api/rooms/:roomId/pins/:messageId',
      config,
      schema: { params: MessageParams, response: answers },
      handler: async (request, reply) => {
        const roomId = request.params.roomId.trim();
        const viewer = await member(request, reply, roomId, 'write');
        if (!viewer) return reply;
        return {
          ok: true as const,
          ...(await deps.pins[change]({ roomId, messageId: request.params.messageId, viewer }))
        };
      }
    });
  }
}
