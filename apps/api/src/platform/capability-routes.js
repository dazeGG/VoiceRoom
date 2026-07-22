'use strict';

const HEALTH_CAPABILITIES_LIMITS = {
  contractVersion: 1
};

function formatCapabilityPayload(readiness) {
  const snapshot = readiness || {};
  return {
    contractVersion: HEALTH_CAPABILITIES_LIMITS.contractVersion,
    apiVersion: '2.5.0',
    features: snapshot?.features || {}
  };
}

function registerCapabilityRoutes({ app, readinessProvider, runLegacyHandler }) {
  if (!app || typeof app.get !== 'function' || !readinessProvider) return;

  app.get('/api/capabilities', (request, reply) => {
    const readiness = readinessProvider.getSnapshot
      ? readinessProvider.getSnapshot()
      : readinessProvider;

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
    features: readiness?.features || {},
    operatorFlags: readiness?.operatorFlags || {},
    replica: readiness?.replica || null,
    ready: readiness?.replica?.ready === true || readiness?.ready === true
  };
}

module.exports = {
  createCapabilitySnapshot,
  registerCapabilityRoutes
};
