import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const REACTION_PATH = '/api/reactions/:type/:conversationId/:messageId';
const REACTOR_PATH = `${REACTION_PATH}/reactors`;

type RouteError = { statusCode?: unknown; message?: string; code?: string } | null | undefined;
type ReactionRoute = {
  Params: { type?: string; conversationId?: string; messageId?: string };
  Body: { emoji?: unknown; active?: unknown } | null;
  Querystring: { emoji?: unknown; [key: string]: unknown };
};
type ReactionRequest = FastifyRequest<ReactionRoute> & { user?: unknown };
type Conversation = { type: string; id: string };
type Viewer = Record<string, unknown> | null;

export interface ReactionRoutesOptions {
  app?: FastifyInstance;
  reactionService?: {
    getSummaries(input: { conversation: Conversation; messageId: string; viewer: Viewer }): Promise<unknown>;
    setDesired(input: { conversation: Conversation; mutation: { messageId: string; emoji: unknown; active: unknown }; viewer: Viewer }): Promise<unknown>;
    getReactors(input: { conversation: Conversation; messageId: string; emoji: unknown; query: Record<string, unknown>; viewer: Viewer }): Promise<Record<string, unknown>>;
  };
  resolveUser?: (request: ReactionRequest) => unknown;
}

// A resolver may hand back the session ({ user }) or the user itself.
function sessionUser(value: unknown): Viewer {
  const resolved = value as { user?: Viewer } & Record<string, unknown> | null | undefined;
  return resolved?.user || resolved || null;
}

function routeInput(request: ReactionRequest): { conversation: Conversation; messageId: string } {
  return {
    conversation: {
      type: String(request.params?.type || ''),
      id: String(request.params?.conversationId || '')
    },
    messageId: String(request.params?.messageId || '')
  };
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const failure = error as RouteError;
  const statusCode = Number.isInteger(failure?.statusCode) ? failure?.statusCode as number : 500;
  if (statusCode >= 500) request.log?.error?.({ err: error }, 'Reaction request failed');
  return reply.code(statusCode).send({
    ok: false,
    code: failure?.code || 'reaction_error',
    error: statusCode >= 500 ? 'Internal server error' : failure?.message
  });
}

function registerReactionRoutes({ app, reactionService, resolveUser }: ReactionRoutesOptions = {}): void {
  if (!app?.get || !app?.put) throw new TypeError('Fastify app is required');
  if (!reactionService?.getSummaries || !reactionService?.setDesired) {
    throw new TypeError('Reaction service is required');
  }
  const reactions = reactionService;

  async function viewer(request: ReactionRequest): Promise<Viewer> {
    const resolved = typeof resolveUser === 'function' ? await resolveUser(request) : request.user;
    return sessionUser(resolved);
  }

  app.get<ReactionRoute>(REACTION_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const summaries = await reactions.getSummaries({ ...input, viewer: await viewer(request) });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, summaries });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.put<ReactionRoute>(REACTION_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const summary = await reactions.setDesired({
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

  app.get<ReactionRoute>(REACTOR_PATH, async (request, reply) => {
    try {
      const input = routeInput(request);
      const page = await reactions.getReactors({
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

export { REACTION_PATH, REACTOR_PATH, registerReactionRoutes };
