'use strict';

const ROOM_HISTORY_PATH = '/api/rooms/:roomId/chat/history';

function sendRouteError(reply, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const publicMessage = statusCode >= 500 ? 'Internal server error' : error.message;
  return reply.code(statusCode).send({
    ok: false,
    code: error?.code || 'history_error',
    error: publicMessage
  });
}

function registerRoomHistoryRoutes({ app, historyService, resolveRoomAccess, path = ROOM_HISTORY_PATH } = {}) {
  if (!app?.get) throw new TypeError('Fastify app is required');
  if (!historyService?.getPage) throw new TypeError('room history service is required');

  app.get(path, async (request, reply) => {
    try {
      const roomId = String(request.params?.roomId || '').trim();
      const decision = typeof resolveRoomAccess === 'function'
        ? await resolveRoomAccess({ request, roomId })
        : { authorized: true };
      const access = decision === true ? { authorized: true } : decision;
      if (!access || access.allowed === false || access.authorized === false) {
        return reply.code(access?.statusCode || 403).send({
          ok: false,
          code: access?.code || 'room_forbidden',
          error: access?.message || 'Room is not available'
        });
      }

      const envelope = await historyService.getPage({
        roomId,
        query: request.query || {},
        access: { ...access, authorized: true }
      });
      return reply.header('Cache-Control', 'no-store').code(200).send(envelope);
    } catch (error) {
      request.log?.error?.({ err: error }, 'room history request failed');
      return sendRouteError(reply, error);
    }
  });
}

module.exports = { ROOM_HISTORY_PATH, registerRoomHistoryRoutes };
