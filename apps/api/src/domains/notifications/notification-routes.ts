import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NotificationService } from './notification-service.ts';

type Viewer = { id: string };
type InboxRoute = {
  Params: { notificationId: string; roomId: string };
  Querystring: { cursor?: string; limit?: unknown };
  Body: { through?: unknown; level?: unknown } | null;
};

function send(reply: FastifyReply, status: number, payload: unknown) {
  return reply.code(status).header?.('Cache-Control', 'no-store').send(payload) ?? reply.code(status).send(payload);
}

function registerNotificationRoutes({
  app,
  service,
  resolveUser,
  enabled = () => true
}: {
  app?: FastifyInstance;
  service?: NotificationService;
  resolveUser?: (request: FastifyRequest) => Viewer | null | undefined | Promise<Viewer | null | undefined>;
  enabled?: (request: FastifyRequest) => unknown;
} = {}): void {
  if (!app || !service || typeof resolveUser !== 'function')
    throw new TypeError('app, service and resolveUser are required');
  const notifications = service;
  const resolve = resolveUser;

  const auth = async (request: FastifyRequest, reply: FastifyReply): Promise<Viewer | null | undefined> => {
    if (!(await enabled(request))) {
      send(reply, 404, { ok: false, error: 'Not found' });
      return null;
    }
    const user = await resolve(request);
    if (!user) send(reply, 401, { ok: false, error: 'Authentication required' });
    return user;
  };

  app.get<InboxRoute>('/api/notifications/inbox', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    try {
      return send(
        reply,
        200,
        await notifications.list({ userId: user.id, cursor: request.query?.cursor, limit: request.query?.limit })
      );
    } catch (error) {
      if ((error as { code?: unknown } | null | undefined)?.code === 'invalid_cursor')
        return send(reply, 400, { ok: false, code: 'invalid_cursor' });
      throw error;
    }
  });

  app.get<InboxRoute>('/api/notifications/inbox/unread-count', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    return send(reply, 200, { ok: true, ...(await notifications.count(user.id)) });
  });

  app.post<InboxRoute>('/api/notifications/inbox/:notificationId/read', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    const result = await notifications.markRead({ userId: user.id, notificationId: request.params.notificationId });
    return send(reply, result.ok ? 200 : 404, result);
  });

  app.post<InboxRoute>('/api/notifications/inbox/read-all', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    return send(
      reply,
      200,
      await notifications.markAllRead({ userId: user.id, through: request.body?.through || null })
    );
  });

  app.get<InboxRoute>('/api/notifications/inbox/resync', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    return send(reply, 200, await notifications.resync(user.id));
  });

  app.get<InboxRoute>('/api/notifications/room/:roomId/level', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    return send(reply, 200, {
      ok: true,
      level: await notifications.getRoomLevel({ userId: user.id, roomId: request.params.roomId })
    });
  });

  app.put<InboxRoute>('/api/notifications/room/:roomId/level', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    const result = await notifications.setRoomLevel({
      userId: user.id,
      roomId: request.params.roomId,
      level: request.body?.level
    });
    return send(reply, (result as { ok?: unknown } | null | undefined)?.ok === false ? 400 : 200, result);
  });
}

export { registerNotificationRoutes };
