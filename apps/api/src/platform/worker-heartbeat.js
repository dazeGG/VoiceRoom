'use strict';

const os = require('node:os');
const { createDbPool } = require('../lib/db');
const { createRuntimeReadinessRepository } = require('./runtime-readiness-repository');

const WORKER_CAPABILITIES = Object.freeze({
  'media-maintenance': ['media-maintenance.G78'],
  'media-processing': ['media-processing.G77', 'media-pressure.G80'],
  'media-reconciliation': ['media-reconciliation.G79'],
  'message-delivery': ['message-delivery.G38'],
  'notification-delivery': ['notification-delivery.G63']
});

async function startWorkerHeartbeat({ env = process.env, workerName } = {}) {
  const capabilityTokens = WORKER_CAPABILITIES[workerName];
  const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!capabilityTokens || !databaseUrl) return Object.freeze({ close: async () => {} });
  const id = String(env.CAPABILITY_RUNTIME_ID || `${os.hostname()}:${workerName}`).trim();
  const intervalMs = Math.max(1_000, Number(env.CAPABILITY_HEARTBEAT_INTERVAL_MS) || 5_000);
  const pool = createDbPool({ databaseUrl });
  const repository = createRuntimeReadinessRepository({ client: pool });
  let timer = null;
  const beat = () => repository.heartbeat({
    kind: 'worker',
    id,
    capabilityTokens,
    ready: true
  });
  await beat();
  timer = setInterval(() => { void beat().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return Object.freeze({
    close: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await repository.remove('worker', id).catch(() => {});
      await pool.end();
    }
  });
}

module.exports = { WORKER_CAPABILITIES, startWorkerHeartbeat };
