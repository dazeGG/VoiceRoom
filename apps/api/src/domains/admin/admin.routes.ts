// The admin panel over HTTP: the numbers, the accounts and the rooms, for a
// staff member signed in to the admin app (its own session cookie, see
// domains/staff), each behind the permission it needs.
// Which accounts carry a mark is public: every client shows it by the name.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, UserIdParams } from '@voice-room/shared/contracts/http';
import { BadgeList } from '@voice-room/shared/contracts/users';
import {
  AccountDetail,
  AccountsPage,
  AccountsQuery,
  AdminOverview,
  BadgeBody,
  BlockBody,
  DeleteAccountBody,
  LiveRooms,
  RoomCalls,
  RoomCallsQuery,
  RoomHistory,
  RoomHistoryQuery,
  ProductQuery,
  ProductStats,
  SystemQuery,
  SystemStats
} from '@voice-room/shared/contracts/admin';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import type { AccountAction, AdminAccountsService } from './admin-accounts.service.ts';
import type { AdminRoomsService } from './admin-rooms.service.ts';
import type { AdminService } from './admin.service.ts';

const ADMIN_REQUIRED = failure('Platform administrator access required', { code: 'platform_admin_required' });
const REFUSALS: Record<Exclude<AccountAction['status'], 'done'>, [number, ReturnType<typeof failure>]> = {
  forbidden: [403, ADMIN_REQUIRED],
  not_found: [404, failure('Account not found', { code: 'account_not_found' })],
  invalid_reason: [400, failure('A reason is required', { code: 'invalid_request' })],
  cannot_moderate_admin: [
    403,
    failure('An administrator account cannot be blocked or deleted', { code: 'cannot_moderate_admin' })
  ],
  confirmation_mismatch: [400, failure('The login does not match the account', { code: 'confirmation_mismatch' })],
  deletion_not_by_admin: [
    409,
    failure('The owner asked for this deletion; only they can call it off', { code: 'deletion_not_by_admin' })
  ],
  unavailable: [503, failure('Account deletion is unavailable', { code: 'account_deletion_unavailable' })]
};

export interface AdminRoutesDeps {
  admin: Pick<AdminService, 'overview' | 'product' | 'system'>;
  accounts: Pick<
    AdminAccountsService,
    'list' | 'detail' | 'block' | 'unblock' | 'signOutEverywhere' | 'remove' | 'cancelDeletion' | 'setBadge' | 'badges'
  >;
  rooms: Pick<AdminRoomsService, 'live' | 'history' | 'calls'>;
  /** The staff member behind the admin-app session, or null with the 401 sent. */
  staffUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null>;
}

export function registerAdminRoutes(root: FastifyInstance, ctx: ApiContext, deps: AdminRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  const actor = (request: FastifyRequest, reply: FastifyReply) => deps.staffUserId(request, reply);

  app.get(
    '/api/admin/overview',
    { schema: { response: { 200: AdminOverview, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const overview = await deps.admin.overview(userId);
      if (!overview) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...overview };
    }
  );

  app.get(
    '/api/admin/product',
    { schema: { querystring: ProductQuery, response: { 200: ProductStats, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const stats = await deps.admin.product(userId, request.query);
      if (!stats) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...stats };
    }
  );

  app.get(
    '/api/admin/system',
    { schema: { querystring: SystemQuery, response: { 200: SystemStats, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const stats = await deps.admin.system(userId, request.query);
      if (!stats) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...stats };
    }
  );

  // --- rooms ------------------------------------------------------------------

  app.get('/api/admin/rooms', { schema: { response: { 200: LiveRooms, '4xx': Failure } } }, async (request, reply) => {
    const userId = await actor(request, reply);
    if (!userId) return reply;
    const live = await deps.rooms.live(userId);
    if (!live) return reply.code(403).send(ADMIN_REQUIRED);
    return { ok: true as const, ...live };
  });

  app.get(
    '/api/admin/rooms/history',
    { schema: { querystring: RoomHistoryQuery, response: { 200: RoomHistory, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const history = await deps.rooms.history(userId, request.query);
      if (!history) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...history };
    }
  );

  app.get(
    '/api/admin/rooms/calls',
    { schema: { querystring: RoomCallsQuery, response: { 200: RoomCalls, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const calls = await deps.rooms.calls(userId, request.query);
      if (!calls) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...calls };
    }
  );

  // --- accounts ---------------------------------------------------------------

  app.get(
    '/api/admin/accounts',
    { schema: { querystring: AccountsQuery, response: { 200: AccountsPage, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const page = await deps.accounts.list(userId, request.query);
      if (!page) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...page };
    }
  );

  function answer(reply: FastifyReply, result: AccountAction) {
    if (result.status === 'done') return { ok: true as const, ...result.detail };
    const [code, body] = REFUSALS[result.status];
    return reply.code(code).send(body);
  }

  const accountSchema = { params: UserIdParams, response: { 200: AccountDetail, '4xx': Failure, 503: Failure } };

  app.get('/api/admin/accounts/:userId', { schema: accountSchema }, async (request, reply) => {
    const adminId = await actor(request, reply);
    if (!adminId) return reply;
    return answer(reply, await deps.accounts.detail(adminId, request.params.userId));
  });

  app.post(
    '/api/admin/accounts/:userId/block',
    { preValidation: optionalJsonBody, schema: { ...accountSchema, body: BlockBody } },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.block(adminId, request.params.userId, request.body));
    }
  );

  app.post(
    '/api/admin/accounts/:userId/unblock',
    { preValidation: optionalJsonBody, schema: accountSchema },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.unblock(adminId, request.params.userId));
    }
  );

  app.post(
    '/api/admin/accounts/:userId/sign-out',
    { preValidation: optionalJsonBody, schema: accountSchema },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.signOutEverywhere(adminId, request.params.userId));
    }
  );

  app.post(
    '/api/admin/accounts/:userId/delete',
    { preValidation: optionalJsonBody, schema: { ...accountSchema, body: DeleteAccountBody } },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.remove(adminId, request.params.userId, request.body));
    }
  );

  app.post(
    '/api/admin/accounts/:userId/cancel-deletion',
    { preValidation: optionalJsonBody, schema: accountSchema },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.cancelDeletion(adminId, request.params.userId));
    }
  );

  app.post(
    '/api/admin/accounts/:userId/badge',
    { preValidation: optionalJsonBody, schema: { ...accountSchema, body: BadgeBody } },
    async (request, reply) => {
      const adminId = await actor(request, reply);
      if (!adminId) return reply;
      return answer(reply, await deps.accounts.setBadge(adminId, request.params.userId, request.body.badge));
    }
  );

  // Public, for guests too: a guest reads the room chat and sees the mark as well.
  app.get('/api/badges', { schema: { response: { 200: BadgeList } } }, async () => ({
    ok: true as const,
    badges: await deps.accounts.badges()
  }));
}
