import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DirectoryListing } from './member-directory-service.ts';
import type { LeaveOutcome, RegisteredAdmission } from './membership-service.ts';
import type { Membership } from './membership-repository.ts';

type Viewer = { id?: string; [key: string]: unknown };
type MembershipRoute = {
  Params: { roomId?: string };
  Querystring: { cursor?: unknown; limit?: unknown; q?: unknown; query?: unknown };
};
type MembershipRequest = FastifyRequest<MembershipRoute>;
type RouteReply = FastifyReply | { status?: (code: number) => { send(payload: unknown): unknown }; code?: undefined };
type LeaveGate = { ok?: boolean; code?: string } | boolean | null | undefined;

function send(reply: RouteReply, statusCode: number, payload: unknown) {
  if (reply && typeof reply.code === 'function') return reply.code(statusCode).send(payload);
  if (reply && typeof reply.status === 'function') return reply.status(statusCode).send(payload);
  throw new TypeError('Unsupported route reply');
}

function viewerOf(session: unknown): Viewer | null | undefined {
  const resolved = session as { user?: Viewer } & Viewer | null | undefined;
  return resolved?.user || resolved;
}

function registerMembershipRoutes<A>({
  app,
  completeAdmission,
  directoryService,
  membershipService,
  onLeft,
  prepareLeave,
  resolveUser,
  membershipEnabled = () => true
}: {
  app?: FastifyInstance;
  completeAdmission?: (input: { request: MembershipRequest; roomId: string | undefined; user: Viewer }) => Promise<A | null | undefined> | A | null | undefined;
  directoryService?: { list(input: { roomId?: string; viewerUserId: string; cursor?: unknown; limit?: unknown; query?: unknown }): Promise<DirectoryListing> };
  membershipService?: {
    admitRegistered(input: { roomId?: string; userId: string; ip: string; completeAdmission: () => unknown }): Promise<RegisteredAdmission<A>>;
    leaveRoom?(input: { roomId?: string; userId: string }): Promise<LeaveOutcome>;
    getMembership(roomId: string | undefined, userId: string): Promise<Membership | null>;
  };
  onLeft?: (input: { request: MembershipRequest; roomId: string | undefined; user: Viewer }) => unknown;
  prepareLeave?: (input: { request: MembershipRequest; roomId: string | undefined; user: Viewer }) => LeaveGate | Promise<LeaveGate>;
  resolveUser?: (request: FastifyRequest) => unknown;
  membershipEnabled?: (request: FastifyRequest) => unknown;
} = {}): void {
  if (!app || typeof app.get !== 'function' || typeof resolveUser !== 'function') {
    throw new TypeError('app and resolveUser are required');
  }
  const resolve = resolveUser;

  app.get<MembershipRoute>('/api/rooms/:roomId/members', async (request, reply) => {
    if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
    const user = viewerOf(await resolve(request));
    if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
    try {
      const result = await directoryService!.list({
        roomId: request.params?.roomId,
        viewerUserId: user.id,
        cursor: request.query?.cursor,
        limit: request.query?.limit,
        query: request.query?.q ?? request.query?.query
      });
      if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Membership required' });
      if (result.status !== 'ok') return send(reply, 401, { ok: false, error: 'Authentication required' });
      return send(reply, 200, result.envelope);
    } catch (error) {
      if ((error as { code?: unknown } | null | undefined)?.code === 'invalid_cursor') return send(reply, 400, { ok: false, error: 'Invalid cursor' });
      throw error;
    }
  });

  if (typeof app.post === 'function' && membershipService && typeof completeAdmission === 'function') {
    const memberships = membershipService;
    const admit = completeAdmission;
    app.post<MembershipRoute>('/api/rooms/:roomId/memberships', async (request, reply) => {
      if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
      const user = viewerOf(await resolve(request));
      if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
      const result = await memberships.admitRegistered({
        roomId: request.params?.roomId,
        userId: user.id,
        ip: request.ip || '',
        completeAdmission: () => admit({ request, roomId: request.params?.roomId, user })
      });
      if (result.status === 'banned') return send(reply, 403, { ok: false, error: 'Room access denied' });
      if (result.status === 'not_found') return send(reply, 404, { ok: false, error: 'Room not found' });
      if (result.status !== 'active') return send(reply, 409, { ok: false, error: 'Admission not completed' });
      return send(reply, 200, { ok: true, admission: result.admission, membership: result.membership });
    });
  }

  if (typeof app.delete === 'function' && membershipService?.leaveRoom) {
    app.delete<MembershipRoute>('/api/rooms/:roomId/memberships/me', async (request, reply) => {
      if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
      const user = viewerOf(await resolve(request));
      if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
      const roomId = request.params?.roomId;
      const membership = await membershipService.getMembership(roomId, user.id);
      if (membership?.role === 'owner') {
        return send(reply, 409, { ok: false, code: 'room_owner_cannot_leave', error: 'Room owner cannot leave their room' });
      }
      if (typeof prepareLeave === 'function') {
        const prepared = await prepareLeave({ request, roomId, user });
        if (prepared === false || (prepared as { ok?: boolean } | null | undefined)?.ok === false) {
          return send(reply, 503, { ok: false, code: (prepared as { code?: string })?.code || 'leave_unavailable', error: 'Unable to revoke room access' });
        }
      }
      const result = await membershipService.leaveRoom!({ roomId, userId: user.id });
      if (result.status === 'owner_required') {
        return send(reply, 409, { ok: false, code: 'room_owner_cannot_leave', error: 'Room owner cannot leave their room' });
      }
      if (result.status !== 'left' && result.status !== 'not_active') {
        return send(reply, 409, { ok: false, code: 'room_leave_failed', error: 'Unable to leave room' });
      }
      // Leaving also takes the room off the user's list. Runs for an already
      // inactive membership too, so retrying a failed leave finishes the job.
      if (typeof onLeft === 'function') await onLeft({ request, roomId, user });
      return send(reply, 200, { ok: true, left: result.status === 'left' });
    });
  }
}

export { registerMembershipRoutes };
