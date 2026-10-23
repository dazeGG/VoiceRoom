// What the server asks of native apps (contracts/client.ts). An Android app
// below ANDROID_MIN_VERSION is refused everywhere else: HTTP 426 from the
// global hook in http/fastify-app.ts, close 4426 on /api/ws. This route is
// never refused, so an outdated app can still learn the threshold.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { ClientPolicy } from '@voice-room/shared/contracts/client';

export const CLIENT_POLICY_PATH = '/api/client/policy';

export function registerClientPolicyRoutes(
  root: FastifyInstance,
  { androidMinVersion }: { androidMinVersion: string }
) {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.get(CLIENT_POLICY_PATH, { schema: { response: { 200: ClientPolicy } } }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { contractVersion: 1 as const, android: { minVersion: androidMinVersion || null } };
  });
}
