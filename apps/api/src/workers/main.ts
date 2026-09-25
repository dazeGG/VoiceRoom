import type pg from 'pg';
import { readDatabaseConfig } from '../lib/config.ts';
import { createDbPool } from '../platform/db/pool.ts';
import { startWorkerMetricsServer } from '../lib/worker-metrics-server.ts';
import { startWorkerHeartbeat } from '../platform/worker-heartbeat.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import { main as mediaMaintenanceMain } from './media-maintenance.ts';
import { main as mediaProcessingMain } from './media-processing.ts';
import { main as mediaReconciliationMain } from './media-reconciliation.ts';
import { main as messageDeliveryMain } from './message-delivery.ts';
import { main as notificationDeliveryMain } from './notification-delivery.ts';

const workers: Readonly<Record<string, (env: NodeJS.ProcessEnv, pool: pg.Pool) => Promise<unknown>>> = Object.freeze({
  'media-maintenance': mediaMaintenanceMain,
  'media-processing': mediaProcessingMain,
  'media-reconciliation': mediaReconciliationMain,
  'message-delivery': messageDeliveryMain,
  'notification-delivery': notificationDeliveryMain
});

async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workerName = String(env.VOICE_ROOM_WORKER || '').trim();
  const run = workers[workerName];
  if (!run) {
    throw new Error(`VOICE_ROOM_WORKER must be one of: ${Object.keys(workers).join(', ')}`);
  }
  const log = createLogger({ env, name: `worker.${workerName}` });
  const metrics = await startWorkerMetricsServer({
    host: env.WORKER_METRICS_HOST || '0.0.0.0',
    port: Number(env.WORKER_METRICS_PORT || 9464)
  });
  // The one pool of this process: the worker and its heartbeat share it.
  const pool = createDbPool({ databaseUrl: readDatabaseConfig(env).url, logger: log });
  const heartbeat = await startWorkerHeartbeat({ env, pool, workerName });
  log.info({ evt: LOG_EVENTS.WORKER_STARTED, worker: workerName }, 'worker started');
  try {
    await run(env, pool);
  } finally {
    await heartbeat.close();
    await metrics.close();
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error | null)?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export { main };
