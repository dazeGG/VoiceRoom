'use strict';

const MODERATION_BANS_PATH = '/api/rooms/:roomId/moderation/bans';
const MODERATION_UNBAN_PATH = '/api/rooms/:roomId/moderation/bans/:banId';
const MODERATION_DELETE_MESSAGE_PATH = '/api/rooms/:roomId/moderation/messages/:messageId';

function send(reply, statusCode, payload) {
  return reply.header('Cache-Control', 'no-store').code(statusCode).send(payload);
}

async function actor(request, resolveUser) {
  const user = await resolveUser(request);
  return user?.id ? user : null;
}

function registerModerationRoutes({ app, moderationService, messageModerationService, resolveUser, enabled = () => true } = {}) {
  if (!app?.get || !app?.put || !app?.delete || typeof resolveUser !== 'function') {
    throw new TypeError('Moderation routes require a Fastify app and resolveUser');
  }
  if (!moderationService?.listActive || !moderationService?.putBan || !moderationService?.unban) {
    throw new TypeError('Moderation service is required');
  }

  app.get(MODERATION_BANS_PATH, async (request, reply) => {
    if (!await enabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
    const user = await actor(request, resolveUser);
    if (!user) return send(reply, 401, { ok: false, error: 'Authentication required' });
    try {
      const result = await moderationService.listActive({
        roomId: request.params.roomId,
        actorUserId: user.id,
        query: request.query || {}
      });
      if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Owner access required' });
      return send(reply, 200, result.envelope);
    } catch (error) {
      if (error?.code === 'invalid_cursor') return send(reply, 400, { ok: false, error: 'Invalid cursor' });
      throw error;
    }
  });

  app.put(MODERATION_BANS_PATH, async (request, reply) => {
    if (!await enabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
    const user = await actor(request, resolveUser);
    if (!user) return send(reply, 401, { ok: false, error: 'Authentication required' });
    const result = await moderationService.putBan({
      roomId: request.params.roomId,
      actorUserId: user.id,
      input: request.body,
      idempotencyKey: request.headers['idempotency-key']
    });
    if (result.status === 'invalid') return send(reply, 400, { ok: false, error: 'Invalid ban request' });
    if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Owner access required' });
    if (result.status === 'cap_exceeded') return send(reply, 409, { ok: false, error: 'Active ban limit reached' });
    if (result.status === 'revocation_unavailable') return send(reply, 503, { ok: false, error: 'Credential revocation unavailable' });
    return send(reply, result.status === 'created' ? 201 : 200, {
      contractVersion: 1,
      status: result.status,
      ban: result.ban
    });
  });

  app.delete(MODERATION_UNBAN_PATH, async (request, reply) => {
    if (!await enabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
    const user = await actor(request, resolveUser);
    if (!user) return send(reply, 401, { ok: false, error: 'Authentication required' });
    const result = await moderationService.unban({
      roomId: request.params.roomId,
      actorUserId: user.id,
      banId: request.params.banId
    });
    if (result.status === 'invalid') return send(reply, 400, { ok: false, error: 'Invalid unban request' });
    if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Owner access required' });
    if (result.status === 'not_found') return send(reply, 404, { ok: false, error: 'Ban not found' });
    return send(reply, 200, { contractVersion: 1, status: 'unbanned', ban: result.ban });
  });

  if (messageModerationService?.deleteRoomMessage) {
    app.delete(MODERATION_DELETE_MESSAGE_PATH, async (request, reply) => {
      if (!await enabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
      const user = await actor(request, resolveUser);
      if (!user) return send(reply, 401, { ok: false, error: 'Authentication required' });
      const result = await messageModerationService.deleteRoomMessage({
        roomId: request.params.roomId,
        messageId: request.params.messageId,
        actorUserId: user.id
      });
      if (result.status === 'invalid') return send(reply, 400, { ok: false, error: 'Invalid message deletion' });
      if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Owner access required' });
      if (result.status === 'not_found') return send(reply, 404, { ok: false, error: 'Message not found' });
      return send(reply, 200, { contractVersion: 1, status: result.status, deletion: result.deletion });
    });
  }
}

module.exports = {
  MODERATION_BANS_PATH,
  MODERATION_DELETE_MESSAGE_PATH,
  MODERATION_UNBAN_PATH,
  registerModerationRoutes
};
