'use strict';

const PIN_COLLECTION_PATH = '/api/rooms/:roomId/pins';
const PIN_ITEM_PATH = `${PIN_COLLECTION_PATH}/:messageId`;

function sendError(request, reply, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) request.log?.error?.({ err: error }, 'Pin request failed');
  return reply.code(statusCode).send({
    ok: false,
    code: error?.code || 'pin_error',
    error: statusCode >= 500 ? 'Internal server error' : error.message
  });
}

function registerPinRoutes({ app, pinService, resolveRoomAccess } = {}) {
  if (!app?.get || !app?.put || !app?.delete) throw new TypeError('Fastify app is required');
  if (!pinService?.list || !pinService?.pin || !pinService?.unpin) {
    throw new TypeError('Pin service is required');
  }

  // Reading and writing pins both require room chat access; the write paths add
  // an account check inside the service. Returns the viewer on success so the
  // handlers can attribute the mutation.
  async function authorize(request, reply, action) {
    const roomId = String(request.params?.roomId || '').trim();
    const decision = typeof resolveRoomAccess === 'function'
      ? await resolveRoomAccess({ request, roomId, action })
      : { authorized: true, viewer: null };
    if (!decision || decision.authorized === false) {
      reply.code(decision?.statusCode || 403).send({
        ok: false,
        code: decision?.code || 'room_forbidden',
        error: decision?.message || 'Room is not available'
      });
      return null;
    }
    return { roomId, viewer: decision.viewer || null };
  }

  app.get(PIN_COLLECTION_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'read');
      if (!access) return reply;
      const snapshot = await pinService.list({ roomId: access.roomId });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...snapshot });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.put(PIN_ITEM_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'write');
      if (!access) return reply;
      const snapshot = await pinService.pin({
        roomId: access.roomId,
        messageId: request.params?.messageId,
        viewer: access.viewer
      });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...snapshot });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete(PIN_ITEM_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'write');
      if (!access) return reply;
      const snapshot = await pinService.unpin({
        roomId: access.roomId,
        messageId: request.params?.messageId,
        viewer: access.viewer
      });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...snapshot });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });
}

module.exports = { PIN_COLLECTION_PATH, PIN_ITEM_PATH, registerPinRoutes };
