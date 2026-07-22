'use strict';

const REACTION_PATH = '/api/reactions/:type/:conversationId/:messageId';
const REACTOR_PATH = `${REACTION_PATH}/reactors`;

function sessionUser(value) {
  return value?.user || value || null;
}

function routeInput(request) {
  return {
    conversation: {
      type: String(request.params?.type || ''),
      id: String(request.params?.conversationId || '')
    },
    messageId: String(request.params?.messageId || '')
  };
}

function sendError(request, reply, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) request.log?.error?.({ err: error }, 'Reaction request failed');
  return reply.code(statusCode).send({
    ok: false,
    code: error?.code || 'reaction_error',
    error: statusCode >= 500 ? 'Internal server error' : error.message
  });
}

function registerReactionRoutes({ app, reactionService, resolveUser } = {}) {
  if (!app?.get || !app?.put) throw new TypeError('Fastify app is required');
  if (!reactionService?.getSummaries || !reactionService?.setDesired) {
    throw new TypeError('Reaction service is required');
  }

  async function viewer(request) {
    const resolved = typeof resolveUser === 'function' ? await resolveUser(request) : request.user;
    return sessionUser(resolved);
  }

  app.get(REACTION_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const summaries = await reactionService.getSummaries({ ...input, viewer: await viewer(request) });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, summaries });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.put(REACTION_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const summary = await reactionService.setDesired({
        conversation: input.conversation,
        mutation: {
          messageId: input.messageId,
          emoji: request.body?.emoji,
          active: request.body?.active
        },
        viewer: await viewer(request)
      });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, summary });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get(REACTOR_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const page = await reactionService.getReactors({
        ...input,
        emoji: request.query?.emoji,
        query: request.query || {},
        viewer: await viewer(request)
      });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...page });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });
}

module.exports = {
  REACTION_PATH,
  REACTOR_PATH,
  registerReactionRoutes
};
