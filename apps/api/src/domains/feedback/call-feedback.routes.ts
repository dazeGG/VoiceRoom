// "How was the call?" over HTTP: anyone who was in a call answers, signed in
// or a guest; a platform administrator reads the answers.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Done, Failure } from '@voice-room/shared/contracts/http';
import { AdminCallFeedbackPage, AdminCallFeedbackQuery, CallFeedbackBody } from '@voice-room/shared/contracts/feedback';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { CallFeedbackService } from './call-feedback.service.ts';
import type { RateCheck } from '../../lib/rate-limit.ts';

const ADMIN_REQUIRED = failure('Platform administrator access required', { code: 'platform_admin_required' });
const TOO_MANY_ANSWERS = failure('Too many answers', { code: 'rate_limited' });

export interface CallFeedbackRoutesDeps {
  feedback: Pick<CallFeedbackService, 'submit' | 'list'>;
  limiter: RateCheck;
  /** The staff member behind the admin-app session, or null with the 401 sent. */
  staffUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null>;
}

export function registerCallFeedbackRoutes(root: FastifyInstance, ctx: ApiContext, deps: CallFeedbackRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/api/feedback/calls',
    { schema: { body: CallFeedbackBody, response: { 201: Done, '4xx': Failure } } },
    async (request, reply) => {
      const userId = (await ctx.resolveSession(request.raw))?.user?.id ?? null;
      // A guest has no account, so guests share their address's allowance.
      const rate = deps.limiter.check(userId ? `user:${userId}` : `ip:${ctx.clientIp(request.raw)}`);
      if (!rate.allowed)
        return reply.code(429).header('Retry-After', String(rate.retryAfterSeconds)).send(TOO_MANY_ANSWERS);
      await deps.feedback.submit(userId, request.body);
      return reply.code(201).send({ ok: true as const });
    }
  );

  app.get(
    '/api/admin/feedback',
    { schema: { querystring: AdminCallFeedbackQuery, response: { 200: AdminCallFeedbackPage, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await deps.staffUserId(request, reply);
      if (!userId) return reply;
      const page = await deps.feedback.list(userId, request.query);
      if (!page) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, ...page };
    }
  );
}
