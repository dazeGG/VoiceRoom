'use strict';

const { PUBLIC_CAPABILITY_KEYS } = require('@voice-room/shared/capabilities');

const HEALTH_CAPABILITIES_LIMITS = {
  contractVersion: 1
};

function publicFeatureFlags(features = {}) {
  return Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, features?.[key] === true]));
}

function formatCapabilityPayload(readiness) {
  const snapshot = readiness || {};
  return {
    contractVersion: HEALTH_CAPABILITIES_LIMITS.contractVersion,
    apiVersion: '2.5.0',
    features: publicFeatureFlags(snapshot?.features)
  };
}

function registerCapabilityRoutes({ app, readinessProvider, runLegacyHandler }) {
  if (!app || typeof app.get !== 'function' || !readinessProvider) return;

  app.get('/api/capabilities', (request, reply) => {
    const readiness = (() => {
      try {
        return readinessProvider.getSnapshot
          ? readinessProvider.getSnapshot()
          : readinessProvider;
      } catch {
        return null;
      }
    })();

    if (typeof runLegacyHandler === 'function') {
      return runLegacyHandler(request, reply, (_req, res) => {
        const payload = formatCapabilityPayload(readiness);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(payload));
      });
    }

    const payload = formatCapabilityPayload(readiness);
    reply
      .header('Cache-Control', 'no-store')
      .code(200)
      .send(payload);
  });
}

function createCapabilitySnapshot(readiness) {
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

module.exports = {
  createCapabilitySnapshot,
  publicFeatureFlags,
  registerCapabilityRoutes
};
