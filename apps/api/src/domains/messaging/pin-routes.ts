import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const PIN_COLLECTION_PATH = '/api/rooms/:roomId/pins';
const PIN_ITEM_PATH = `${PIN_COLLECTION_PATH}/:messageId`;

type RouteError = { statusCode?: unknown; message?: string; code?: string } | null | undefined;
type PinRoute = { Params: { roomId?: string; messageId?: string } };
type PinRequest = FastifyRequest<PinRoute>;
type Decision = { authorized?: boolean; viewer?: unknown; statusCode?: number; code?: string; message?: string } | null | undefined;
type PinSnapshot = Record<string, unknown>;

export interface PinRoutesOptions {
  app?: FastifyInstance;
  pinService?: {
    list(input: { roomId: string }): Promise<PinSnapshot>;
    pin(input: { roomId: string; messageId: string | undefined; viewer: unknown }): Promise<PinSnapshot>;
    unpin(input: { roomId: string; messageId: string | undefined; viewer: unknown }): Promise<PinSnapshot>;
  };
  resolveRoomAccess?: (input: { request: PinRequest; roomId: string; action: 'read' | 'write' }) => Decision | Promise<Decision>;
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const failure = error as RouteError;
  const statusCode = Number.isInteger(failure?.statusCode) ? failure?.statusCode as number : 500;
  if (statusCode >= 500) request.log?.error?.({ err: error }, 'Pin request failed');
  return reply.code(statusCode).send({
    ok: false,
    code: failure?.code || 'pin_error',
    error: statusCode >= 500 ? 'Internal server error' : failure?.message
  });
}

function registerPinRoutes({ app, pinService, resolveRoomAccess }: PinRoutesOptions = {}): void {
  if (!app?.get || !app?.put || !app?.delete) throw new TypeError('Fastify app is required');
  if (!pinService?.list || !pinService?.pin || !pinService?.unpin) {
    throw new TypeError('Pin service is required');
  }
  const pins = pinService;

  // Reading and writing pins both require room chat access; the write paths add
  // an account check inside the service. Returns the viewer on success so the
  // handlers can attribute the mutation.
  async function authorize(request: PinRequest, reply: FastifyReply, action: 'read' | 'write') {
    const roomId = String(request.params?.roomId || '').trim();
    const decision: Decision = typeof resolveRoomAccess === 'function'
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

  app.get<PinRoute>(PIN_COLLECTION_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'read');
      if (!access) return reply;
      const snapshot = await pins.list({ roomId: access.roomId });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...snapshot });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.put<PinRoute>(PIN_ITEM_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'write');
      if (!access) return reply;
      const snapshot = await pins.pin({
        roomId: access.roomId,
        messageId: request.params?.messageId,
        viewer: access.viewer
      });
      return reply.header('Cache-Control', 'no-store').code(200).send({ ok: true, ...snapshot });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete<PinRoute>(PIN_ITEM_PATH, async (request, reply) => {
    try {
      const access = await authorize(request, reply, 'write');
      if (!access) return reply;
      const snapshot = await pins.unpin({
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

export { PIN_COLLECTION_PATH, PIN_ITEM_PATH, registerPinRoutes };
