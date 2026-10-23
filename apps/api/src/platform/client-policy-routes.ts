// What the server asks of native apps (contracts/client.ts). An Android app
// below ANDROID_MIN_VERSION is refused everywhere else: HTTP 426 from the
// global hook in http/fastify-app.ts, close 4426 on /api/ws. This route is
// never refused, so an outdated app can still learn the threshold.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { isVersionBelow, parseAndroidAppVersion } from '@voice-room/shared/client-version';
import { ClientPolicy } from '@voice-room/shared/contracts/client';

export const CLIENT_POLICY_PATH = '/api/client/policy';

/**
 * The app's version when the user agent is the Android app below
 * `minVersion` (an empty string for a malformed one); null for everyone else
 * and whenever no minimum is set. The user agent is parsed at most once.
 */
export function outdatedAndroidVersion(userAgent: string | undefined, minVersion: string): string | null {
  if (!minVersion) return null;
  const version = parseAndroidAppVersion(userAgent);
  return version !== null && isVersionBelow(version, minVersion) ? version : null;
}

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
