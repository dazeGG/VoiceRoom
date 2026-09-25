import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const ROOM_HISTORY_PATH = '/api/rooms/:roomId/chat/history';

type RouteError = { statusCode?: unknown; message?: string; code?: string } | null | undefined;
type RoomAccess = {
  allowed?: boolean;
  authorized?: boolean;
  statusCode?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
};
type HistoryRoute = { Params: { roomId?: string }; Querystring: Record<string, unknown> };
type HistoryRequest = FastifyRequest<HistoryRoute>;

export interface RoomHistoryRoutesOptions {
  app?: FastifyInstance;
  historyService?: {
    getPage(input: { roomId: string; query: Record<string, unknown>; access: RoomAccess }): Promise<unknown>;
  };
  resolveRoomAccess?: (input: {
    request: HistoryRequest;
    roomId: string;
  }) => Promise<RoomAccess | boolean | null> | RoomAccess | boolean | null;
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

function registerRoomHistoryRoutes({
  app,
  historyService,
  resolveRoomAccess,
  path = ROOM_HISTORY_PATH
}: RoomHistoryRoutesOptions = {}): void {
  if (!app?.get) throw new TypeError('Fastify app is required');
  if (!historyService?.getPage) throw new TypeError('room history service is required');
  const history = historyService;

  app.get<HistoryRoute>(path, async (request, reply) => {
    try {
      const roomId = String(request.params?.roomId || '').trim();
      const decision =
        typeof resolveRoomAccess === 'function' ? await resolveRoomAccess({ request, roomId }) : { authorized: true };
      const access = decision === true ? { authorized: true } : decision;
      if (!access || access.allowed === false || access.authorized === false) {
        const refusal = access || null;
        return reply.code(refusal?.statusCode || 403).send({
          ok: false,
          code: refusal?.code || 'room_forbidden',
          error: refusal?.message || 'Room is not available'
        });
      }

      const envelope = await history.getPage({
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

export { ROOM_HISTORY_PATH, registerRoomHistoryRoutes };
