// The mention/reply inbox and per-room notification levels over HTTP. Answers
// are never cached: the unread count moves with every message.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import {
  InboxItemRead,
  InboxPage,
  InboxQuery,
  InboxReadAll,
  InboxResync,
  NotificationIdParams,
  ReadAllBody,
  RoomLevel,
  RoomLevelBody,
  UnreadCount
} from '@voice-room/shared/contracts/notifications';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import type { NotificationService } from './notification-service.ts';

export interface NotificationRoutesDeps {
  notifications: NotificationService;
  /** The inbox answers 404 while its feature is switched off. */
  enabled(): boolean;
}

const answers = <Success>(success: Success) => ({ 200: success, '4xx': Failure });

async function noStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'no-store');
}

export function registerNotificationRoutes(root: FastifyInstance, ctx: ApiContext, deps: NotificationRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const { notifications } = deps;

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    if (!deps.enabled()) {
      reply.code(404).send(failure('Not found', { code: 'not_found' }));
      return null;
    }
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
    return null;
  }

  app.get(
    '/api/notifications/inbox',
    { onRequest: noStore, schema: { querystring: InboxQuery, response: answers(InboxPage) } },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      try {
        return await notifications.list({ userId, cursor: request.query.cursor, limit: request.query.limit });
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'invalid_cursor')
          return reply.code(400).send(failure('Invalid cursor', { code: 'invalid_cursor' }));
        throw error;
      }
    }
  );

  app.get(
    '/api/notifications/inbox/unread-count',
    { onRequest: noStore, schema: { response: answers(UnreadCount) } },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      return { ok: true as const, ...(await notifications.count(userId)) };
    }
  );

  app.post(
    '/api/notifications/inbox/:notificationId/read',
    { onRequest: noStore, schema: { params: NotificationIdParams, response: answers(InboxItemRead) } },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      const result = await notifications.markRead({ userId, notificationId: request.params.notificationId });
      if (!result.ok) return reply.code(404).send(failure('Notification not found', { code: result.code }));
      return result;
    }
  );

  app.post(
    '/api/notifications/inbox/read-all',
    {
      onRequest: noStore,
      preValidation: optionalJsonBody,
      schema: { body: ReadAllBody, response: answers(InboxReadAll) }
    },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      return notifications.markAllRead({ userId, through: request.body.through || null });
    }
  );

  app.get(
    '/api/notifications/inbox/resync',
    { onRequest: noStore, schema: { response: answers(InboxResync) } },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      return notifications.resync(userId);
    }
  );

  app.get(
    '/api/notifications/room/:roomId/level',
    { onRequest: noStore, schema: { params: RoomIdParams, response: answers(RoomLevel) } },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      return { ok: true as const, level: await notifications.getRoomLevel({ userId, roomId: request.params.roomId }) };
    }
  );

  app.put(
    '/api/notifications/room/:roomId/level',
    {
      onRequest: noStore,
      preValidation: optionalJsonBody,
      schema: { params: RoomIdParams, body: RoomLevelBody, response: answers(RoomLevel) }
    },
    async (request, reply) => {
      const userId = await signedIn(request, reply);
      if (!userId) return reply;
      const result = await notifications.setRoomLevel({
        userId,
        roomId: request.params.roomId,
        level: request.body.level
      });
      if (!result.ok) return reply.code(400).send(failure('Invalid notification level', { code: result.code }));
      return result;
    }
  );
}
