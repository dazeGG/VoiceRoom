// A room's member directory and leaving a room over HTTP.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import { MemberPage, MembersQuery, MembershipLeft } from '@voice-room/shared/contracts/membership';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { DirectoryListing } from './member-directory.service.ts';
import type { Membership } from './membership.repository.ts';
import type { LeaveOutcome } from './membership.service.ts';
import { mayLeaveRoom } from './membership.policy.ts';

const NOT_FOUND = failure('Not found', { code: 'not_found' });
const SIGN_IN_REQUIRED = failure('Authentication required', { code: 'authentication_required' });
const OWNER_CANNOT_LEAVE = failure('Room owner cannot leave their room', { code: 'room_owner_cannot_leave' });

/** Revoking the account's live access before its membership ends; false or `{ ok: false }` stops the leave. */
export type LeaveGate = { ok: boolean; code?: string } | boolean;

export interface MembershipRoutesDeps {
  directory: {
    list(input: {
      roomId: string;
      viewerUserId: string;
      cursor?: string;
      limit?: string;
      query?: string;
    }): Promise<DirectoryListing>;
  };
  memberships: {
    getMembership(roomId: string, userId: string): Promise<Membership | null>;
    leaveRoom(input: { roomId: string; userId: string }): Promise<LeaveOutcome>;
  };
  /** Room membership is behind a capability flag until it is on everywhere. */
  enabled(): boolean;
  prepareLeave(input: { roomId: string; userId: string }): Promise<LeaveGate>;
  /** Leaving also takes the room off the account's list. */
  onLeft(input: { roomId: string; userId: string }): Promise<void>;
}

export function registerMembershipRoutes(root: FastifyInstance, ctx: ApiContext, deps: MembershipRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function member(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    if (!deps.enabled()) {
      reply.code(404).send(NOT_FOUND);
      return null;
    }
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(SIGN_IN_REQUIRED);
    return null;
  }

  app.get(
    '/api/rooms/:roomId/members',
    { schema: { params: RoomIdParams, querystring: MembersQuery, response: { 200: MemberPage, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await member(request, reply);
      if (!userId) return reply;
      const { cursor, limit, q, query } = request.query;
      try {
        const result = await deps.directory.list({
          roomId: request.params.roomId,
          viewerUserId: userId,
          cursor,
          limit,
          query: q ?? query
        });
        if (result.status === 'forbidden')
          return reply.code(403).send(failure('Membership required', { code: 'membership_required' }));
        if (result.status !== 'ok') return reply.code(401).send(SIGN_IN_REQUIRED);
        return result.envelope;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'invalid_cursor')
          return reply.code(400).send(failure('Invalid cursor', { code: 'invalid_cursor' }));
        throw error;
      }
    }
  );

  app.delete(
    '/api/rooms/:roomId/memberships/me',
    { schema: { params: RoomIdParams, response: { 200: MembershipLeft, '4xx': Failure, 503: Failure } } },
    async (request, reply) => {
      const userId = await member(request, reply);
      if (!userId) return reply;
      const { roomId } = request.params;
      const membership = await deps.memberships.getMembership(roomId, userId);
      if (!mayLeaveRoom(membership)) return reply.code(409).send(OWNER_CANNOT_LEAVE);
      const prepared = await deps.prepareLeave({ roomId, userId });
      if (prepared === false || (typeof prepared === 'object' && !prepared.ok)) {
        const reason = (typeof prepared === 'object' && prepared.code) || 'leave_unavailable';
        request.log.warn({ roomId, reason }, 'room leave could not revoke live access');
        return reply.code(503).send(failure('Unable to revoke room access', { code: 'room_leave_unavailable' }));
      }
      const result = await deps.memberships.leaveRoom({ roomId, userId });
      if (result.status === 'owner_required') return reply.code(409).send(OWNER_CANNOT_LEAVE);
      if (result.status !== 'left' && result.status !== 'not_active') {
        return reply.code(409).send(failure('Unable to leave room', { code: 'room_leave_failed' }));
      }
      // Runs for an already inactive membership too, so retrying a failed
      // leave finishes the job.
      await deps.onLeft({ roomId, userId });
      return { ok: true as const, left: result.status === 'left' };
    }
  );
}
