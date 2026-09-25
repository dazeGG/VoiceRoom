import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const DM_HISTORY_PATH = '/api/dm/:userId/history';

type RouteError = { statusCode?: unknown; message?: string; code?: string } | null | undefined;
type SessionUser = { id?: string; [key: string]: unknown };
type HistoryRoute = { Params: { userId?: string }; Querystring: Record<string, unknown> };
type HistoryRequest = FastifyRequest<HistoryRoute> & { user?: unknown };

export interface DmHistoryRoutesOptions {
  app?: FastifyInstance;
  historyService?: {
    getPage(input: { userId: string; peerId: string; query: Record<string, unknown> }): Promise<unknown>;
  };
  resolveUser?: (request: HistoryRequest) => unknown;
  path?: string;
}

function sendRouteError(reply: FastifyReply, error: unknown) {
  const failure = error as RouteError;
  const statusCode = Number.isInteger(failure?.statusCode) ? (failure?.statusCode as number) : 500;
  const publicMessage = statusCode >= 500 ? 'Internal server error' : failure?.message;
  return reply.code(statusCode).send({
    ok: false,
    code: failure?.code || 'history_error',
    error: publicMessage
  });
}

// A resolver may hand back the session ({ user }) or the user itself.
function sessionUser(value: unknown): SessionUser | null {
  const resolved = value as ({ user?: SessionUser } & SessionUser) | null | undefined;
  return resolved?.user || resolved || null;
}

function registerDmHistoryRoutes({
  app,
  historyService,
  resolveUser,
  path = DM_HISTORY_PATH
}: DmHistoryRoutesOptions = {}): void {
  if (!app?.get) throw new TypeError('Fastify app is required');
  if (!historyService?.getPage) throw new TypeError('DM history service is required');
  const history = historyService;

  app.get<HistoryRoute>(path, async (request, reply) => {
    try {
      const resolved =
        typeof resolveUser === 'function' ? await resolveUser(request) : (request as HistoryRequest).user;
      const user = sessionUser(resolved);
      if (!user?.id) {
        return reply.code(401).send({
          ok: false,
          code: 'authentication_required',
          error: 'Authentication required'
        });
      }

      const envelope = await history.getPage({
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

export { DM_HISTORY_PATH, registerDmHistoryRoutes };
