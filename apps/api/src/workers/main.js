import { startWorkerMetricsServer } from '../lib/worker-metrics-server.ts';
import { startWorkerHeartbeat } from '../platform/worker-heartbeat.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import { main as mediaMaintenanceMain } from './media-maintenance.js';
import { main as mediaProcessingMain } from './media-processing.js';
import { main as mediaReconciliationMain } from './media-reconciliation.js';
import { main as messageDeliveryMain } from './message-delivery.js';
import { main as notificationDeliveryMain } from './notification-delivery.js';

const workers = Object.freeze({
  'media-maintenance': mediaMaintenanceMain,
  'media-processing': mediaProcessingMain,
  'media-reconciliation': mediaReconciliationMain,
  'message-delivery': messageDeliveryMain,
  'notification-delivery': notificationDeliveryMain
});

async function main(env = process.env) {
  const workerName = String(env.VOICE_ROOM_WORKER || '').trim();
  const run = workers[workerName];
  if (!run) {
    throw new Error(`VOICE_ROOM_WORKER must be one of: ${Object.keys(workers).join(', ')}`);
  }
  const log = createLogger({ env, name: `worker.${workerName}` });
  const metrics = await startWorkerMetricsServer({ host: env.WORKER_METRICS_HOST || '0.0.0.0', port: Number(env.WORKER_METRICS_PORT || 9464) });
  const heartbeat = await startWorkerHeartbeat({ env, workerName });
  log.info({ evt: LOG_EVENTS.WORKER_STARTED, worker: workerName }, 'worker started');
  try { await run(env); }
  finally {
    await heartbeat.close();
    await metrics.close();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export { main };
