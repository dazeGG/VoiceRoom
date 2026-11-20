import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Health } from '@voice-room/shared/contracts/ops';
import { Failure } from '@voice-room/shared/contracts/http';
import { failure } from '../../platform/http/http-kit.ts';

export function registerHealthRoutes(
  root: FastifyInstance,
  { livekitEnabled, ready }: { livekitEnabled: () => boolean; ready?: () => Promise<boolean> }
): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const health = () => ({ livekit: livekitEnabled(), ok: true as const });

  // Public health exposes neither the topology nor room occupancy.
  app.get('/api/healthz', { schema: { response: { 200: Health } } }, async () => health());
  if (ready) {
    app.get('/api/readyz', { schema: { response: { 200: Health, 503: Failure } } }, async (_request, reply) => {
      if (await ready()) return health();
      return reply.code(503).send(failure('Call runtime unavailable', { code: 'livekit_gate_unavailable' }));
    });
  }
}
