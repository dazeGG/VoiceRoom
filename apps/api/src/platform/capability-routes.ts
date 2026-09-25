import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { PUBLIC_CAPABILITY_KEYS } from '@voice-room/shared/capabilities';
import { Capabilities } from '@voice-room/shared/contracts/ops';

type ReadinessLike =
  | {
      features?: Record<string, unknown>;
      manifest?: { contractVersion?: string; digest?: string; schemaVersion?: number };
      replica?: { ready?: boolean; [key: string]: unknown } | null;
      ready?: boolean;
    }
  | null
  | undefined;

type ReadinessSource = { getSnapshot?: () => ReadinessLike } & Record<string, unknown>;

function publicFeatureFlags(features: Record<string, unknown> | null | undefined = {}): Record<string, boolean> {
  return Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, features?.[key] === true]));
}

/** The public feature flags: every known key, true only when the replica reports it on. */
function registerCapabilityRoutes(root: FastifyInstance, readiness: ReadinessSource): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/api/capabilities', { schema: { response: { 200: Capabilities } } }, async (_request, reply) => {
    let snapshot: ReadinessLike = null;
    try {
      snapshot = readiness.getSnapshot ? readiness.getSnapshot() : (readiness as ReadinessLike);
    } catch {
      // An unreadable snapshot reports every feature off.
    }
    reply.header('Cache-Control', 'no-store');
    return {
      contractVersion: 1 as const,
      apiVersion: '2.5.0',
      features: publicFeatureFlags(snapshot?.features)
    };
  });
}

function createCapabilitySnapshot(readiness: ReadinessLike) {
  return {
    contractVersion: readiness?.manifest?.contractVersion || 'voice-room.capabilities/v1',
    apiVersion: '2.5.0',
    manifestDigest: readiness?.manifest?.digest || null,
    manifestSchemaVersion: readiness?.manifest?.schemaVersion || 1,
    features: publicFeatureFlags(readiness?.features),
    replica: readiness?.replica || null,
    ready: readiness?.replica?.ready === true || readiness?.ready === true
  };
}

export { createCapabilitySnapshot, publicFeatureFlags, registerCapabilityRoutes };
