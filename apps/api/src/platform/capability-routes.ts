// Every feature that release 2.5 once switched on per environment is on
// everywhere. Web clients and desktop builds from before that still ask which
// features they may show, so the route stays and answers yes to all of them.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Capabilities, PUBLIC_CAPABILITY_KEYS } from '@voice-room/shared/contracts/ops';

const EVERY_FEATURE_ON = Object.freeze(Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, true])));

function registerCapabilityRoutes(root: FastifyInstance): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/api/capabilities', { schema: { response: { 200: Capabilities } } }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { contractVersion: 1 as const, apiVersion: '2.5.0', features: EVERY_FEATURE_ON };
  });
}

export { registerCapabilityRoutes };
