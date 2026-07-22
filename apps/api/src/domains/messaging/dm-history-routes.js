'use strict';

const DM_HISTORY_PATH = '/api/dm/:userId/history';

function sendRouteError(reply, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const publicMessage = statusCode >= 500 ? 'Internal server error' : error.message;
  return reply.code(statusCode).send({
    ok: false,
    code: error?.code || 'history_error',
    error: publicMessage
  });
}

function sessionUser(value) {
  return value?.user || value || null;
}

function registerDmHistoryRoutes({ app, historyService, resolveUser, path = DM_HISTORY_PATH } = {}) {
  if (!app?.get) throw new TypeError('Fastify app is required');
  if (!historyService?.getPage) throw new TypeError('DM history service is required');

  app.get(path, async (request, reply) => {
    try {
      const resolved = typeof resolveUser === 'function'
        ? await resolveUser(request)
        : request.user;
      const user = sessionUser(resolved);
      if (!user?.id) {
        return reply.code(401).send({
          ok: false,
          code: 'authentication_required',
          error: 'Authentication required'
        });
      }

      const envelope = await historyService.getPage({
        userId: user.id,
        peerId: String(request.params?.userId || '').trim(),
        query: request.query || {}
      });
      return reply.header('Cache-Control', 'no-store').code(200).send(envelope);
    } catch (error) {
      request.log?.error?.({ err: error }, 'DM history request failed');
      return sendRouteError(reply, error);
    }
  });
}

module.exports = { DM_HISTORY_PATH, registerDmHistoryRoutes };
