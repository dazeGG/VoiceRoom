// Reports to the service operator over HTTP: any signed-in account files one,
// a platform administrator lists the open ones and resolves them.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure } from '@voice-room/shared/contracts/http';
import {
  AdminReportPage,
  ReportBody,
  ReportFiled,
  ReportIdParams,
  ReportResolveBody,
  ReportResolved
} from '@voice-room/shared/contracts/reports';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { ReportService } from './report.service.ts';

const SIGN_IN_REQUIRED = failure('Authentication required', { code: 'authentication_required' });
const ADMIN_REQUIRED = failure('Platform administrator access required', { code: 'platform_admin_required' });
const TARGET_NOT_FOUND = failure('Message not found', { code: 'report_target_not_found' });
const OWN_MESSAGE = failure('Your own message cannot be reported', { code: 'report_own_message' });
const REPORT_NOT_FOUND = failure('Report not found', { code: 'report_not_found' });
const TOO_MANY_REPORTS = failure('Too many reports', { code: 'rate_limited' });

export interface ReportRoutesDeps {
  reports: Pick<ReportService, 'fileReport' | 'listOpen' | 'resolve'>;
  limiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
  /** The staff member behind the admin-app session, or null with the 401 sent. */
  staffUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null>;
}

export function registerReportRoutes(root: FastifyInstance, ctx: ApiContext, deps: ReportRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(SIGN_IN_REQUIRED);
    return null;
  }

  app.post(
    '/api/reports',
    { schema: { body: ReportBody, response: { 200: ReportFiled, 201: ReportFiled, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await actor(request, reply);
      if (!userId) return reply;
      const rate = deps.limiter.check(userId);
      if (!rate.allowed)
        return reply.code(429).header('Retry-After', String(rate.retryAfterSeconds)).send(TOO_MANY_REPORTS);
      const result = await deps.reports.fileReport(userId, request.body);
      switch (result.status) {
        case 'target_not_found':
          return reply.code(404).send(TARGET_NOT_FOUND);
        case 'own_message':
          return reply.code(400).send(OWN_MESSAGE);
        case 'filed':
        case 'already_filed':
          return reply.code(result.status === 'filed' ? 201 : 200).send({ ok: true as const, status: result.status });
      }
    }
  );

  app.get(
    '/api/admin/reports',
    { schema: { response: { 200: AdminReportPage, '4xx': Failure } } },
    async (request, reply) => {
      const userId = await deps.staffUserId(request, reply);
      if (!userId) return reply;
      const reports = await deps.reports.listOpen(userId);
      if (!reports) return reply.code(403).send(ADMIN_REQUIRED);
      return { ok: true as const, reports };
    }
  );

  app.post(
    '/api/admin/reports/:reportId/resolve',
    {
      schema: { params: ReportIdParams, body: ReportResolveBody, response: { 200: ReportResolved, '4xx': Failure } }
    },
    async (request, reply) => {
      const userId = await deps.staffUserId(request, reply);
      if (!userId) return reply;
      const result = await deps.reports.resolve(userId, request.params.reportId, request.body.action);
      if (result.status === 'forbidden') return reply.code(403).send(ADMIN_REQUIRED);
      if (result.status === 'not_found') return reply.code(404).send(REPORT_NOT_FOUND);
      return { ok: true as const, resolved: result.resolved };
    }
  );
}
