import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { PrivacyAllowParams, PrivacyResponse, PrivacySettings } from '@voiceroom/shared/contracts/privacy';
import { Failure } from '@voiceroom/shared/contracts/http';
import type { FastifyInstance } from 'fastify';
import { requireSession, type ApiContext } from '../../app/context.ts';
import type { createPrivacyService } from './privacy.service.ts';

export function registerPrivacyRoutes(
  root: FastifyInstance,
  ctx: ApiContext,
  privacy: ReturnType<typeof createPrivacyService>
) {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const response = { 200: PrivacyResponse, '4xx': Failure };

  app.get('/api/privacy', { schema: { response } }, async (request) => {
    const { user } = await requireSession(ctx, request);
    return { ok: true as const, privacy: await privacy.get(user.id) };
  });

  app.put('/api/privacy', { schema: { body: PrivacySettings, response } }, async (request) => {
    const { user } = await requireSession(ctx, request);
    return { ok: true as const, privacy: await privacy.save(user.id, request.body) };
  });

  for (const method of ['PUT', 'DELETE'] as const) {
    app.route({
      method,
      url: '/api/privacy/allow/:kind/:userId',
      schema: { params: PrivacyAllowParams, response },
      async handler(request) {
        const { user } = await requireSession(ctx, request);
        const { kind, userId } = request.params;
        return { ok: true as const, privacy: await privacy.allow(user.id, kind, userId, method === 'PUT') };
      }
    });
  }
}
