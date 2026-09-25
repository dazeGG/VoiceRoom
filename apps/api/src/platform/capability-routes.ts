import type { FastifyInstance } from 'fastify';
import { PUBLIC_CAPABILITY_KEYS } from '@voice-room/shared/capabilities';

const HEALTH_CAPABILITIES_LIMITS = {
  contractVersion: 1
};

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

function formatCapabilityPayload(readiness: ReadinessLike) {
  const snapshot = readiness || {};
  return {
    contractVersion: HEALTH_CAPABILITIES_LIMITS.contractVersion,
    apiVersion: '2.5.0',
    features: publicFeatureFlags(snapshot?.features)
  };
}

function registerCapabilityRoutes({
  app,
  readinessProvider
}: {
  app?: FastifyInstance;
  readinessProvider?: ReadinessSource | null;
}): void {
  if (!app || typeof app.get !== 'function' || !readinessProvider) return;
  const provider = readinessProvider;

  app.get('/api/capabilities', (_request, reply) => {
    const readiness = (() => {
      try {
        return provider.getSnapshot ? provider.getSnapshot() : (provider as ReadinessLike);
      } catch {
        return null;
      }
    })();

    const payload = formatCapabilityPayload(readiness);
    reply.header('Cache-Control', 'no-store').code(200).send(payload);
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
