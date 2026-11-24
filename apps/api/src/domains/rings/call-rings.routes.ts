import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Failure } from '@voiceroom/shared/contracts/http';
import { CallBootstrap } from '@voiceroom/shared/contracts/rings';
import { requireSession, type ApiContext } from '../../app/context.ts';

export function registerCallRingRoutes(root: FastifyInstance, ctx: ApiContext, enabled: boolean): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.get(
    '/api/call-rings',
    { schema: { response: { 200: CallBootstrap, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await requireSession(ctx, request);
      return { ok: true as const, enabled, activeCalls: [], incoming: [], missed: [], serverNow: Date.now() };
    }
  );
}
