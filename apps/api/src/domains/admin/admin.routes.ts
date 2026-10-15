// The admin panel over HTTP: any signed-in account learns whether it is an
// administrator; the numbers answer an administrator only.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure } from '@voice-room/shared/contracts/http';
import {
  AdminAccess,
  AdminOverview,
  ProductQuery,
  ProductStats,
  SystemQuery,
  SystemStats
} from '@voice-room/shared/contracts/admin';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { AdminService } from './admin.service.ts';

const SIGN_IN_REQUIRED = failure('Authentication required', { code: 'authentication_required' });
const ADMIN_REQUIRED = failure('Platform administrator access required', { code: 'platform_admin_required' });

export interface AdminRoutesDeps {
  admin: Pick<AdminService, 'access' | 'overview' | 'product' | 'system'>;
}

export function registerAdminRoutes(root: FastifyInstance, ctx: ApiContext, deps: AdminRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(SIGN_IN_REQUIRED);
    return null;
  }

  app.get(
    '/api/admin/access',
    { schema: { response: { 200: AdminAccess, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      return { ok: true as const, ...(await deps.admin.access(userId)) };
    }
  );

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
}
