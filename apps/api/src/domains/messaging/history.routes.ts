// Paginated message history over HTTP: a room's chat and a direct thread.
// Refusals carry a code the web client branches on.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import { DirectHistoryPage, HistoryQuery, PeerParams, RoomHistoryPage } from '@voice-room/shared/contracts/messages';
import type { ApiContext } from '../../app/context.ts';
import { failure, sendServiceError } from '../../platform/http/http-kit.ts';

type Query = Record<string, string | undefined>;

export interface HistoryRoutesDeps {
  rooms: {
    getPage(input: { roomId: string; query: Query; access: { authorized: true } }): Promise<RoomHistoryPage>;
  };
  directs: { getPage(input: { userId: string; peerId: string; query: Query }): Promise<DirectHistoryPage> };
  /** Whether the account may read the room's chat (owner, member or bookmark). */
  canReadRoom(roomId: string, userId: string): Promise<boolean>;
}

const answers = <Page>(page: Page) => ({ 200: page, '4xx': Failure, '5xx': Failure });

export function registerHistoryRoutes(root: FastifyInstance, ctx: ApiContext, deps: HistoryRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/api/rooms/:roomId/chat/history',
    { schema: { params: RoomIdParams, querystring: HistoryQuery, response: answers(RoomHistoryPage) } },
    async (request, reply) => {
      const roomId = request.params.roomId.trim();
      const userId = (await ctx.resolveSession(request.raw))?.user?.id;
      if (!userId || !(await deps.canReadRoom(roomId, userId))) {
        return reply.code(userId ? 403 : 401).send(failure('Room is not available', { code: 'room_forbidden' }));
      }
      try {
        return await deps.rooms.getPage({ roomId, query: request.query, access: { authorized: true } });
      } catch (error) {
        return sendServiceError(reply, error, {
          fallback: 'history_error',
          log: request.log,
          what: 'room history request'
        });
      }
    }
  );

  app.get(
    '/api/dm/:userId/history',
    { schema: { params: PeerParams, querystring: HistoryQuery, response: answers(DirectHistoryPage) } },
    async (request, reply) => {
      const userId = (await ctx.resolveSession(request.raw))?.user?.id;
      if (!userId) {
        return reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
      }
      try {
        return await deps.directs.getPage({ userId, peerId: request.params.userId.trim(), query: request.query });
      } catch (error) {
        return sendServiceError(reply, error, {
          fallback: 'history_error',
          log: request.log,
          what: 'DM history request'
        });
      }
    }
  );
}
