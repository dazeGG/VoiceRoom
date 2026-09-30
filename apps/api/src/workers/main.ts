import type pg from 'pg';
import { readDatabaseConfig } from '../lib/config.ts';
import { createDbPool } from '../platform/db/pool.ts';
import { startWorkerMetricsServer } from '../lib/worker-metrics-server.ts';
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

async function main(
  env: NodeJS.ProcessEnv = process.env,
  { stopSignal = stopSignalFromProcess() }: { stopSignal?: AbortSignal } = {}
): Promise<void> {
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
  // The one pool of this process.
  const pool = createDbPool({ databaseUrl: readDatabaseConfig(env).url, logger: log });
  log.info({ evt: LOG_EVENTS.WORKER_STARTED, worker: workerName }, 'worker started');
  try {
    await run(env, pool);
  } finally {
    await metrics.close();
    await pool.end();
  }
  // A worker whose claims are off returns at once. Compose restarts a worker
  // unless it was stopped (a host reboot ends every one with exit 0), so this
  // one stays up, idle, until it is stopped.
  await untilAborted(stopSignal);
}

function stopSignalFromProcess(): AbortSignal {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
  return controller.signal;
}

function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    // A pending promise alone does not keep the process alive.
    const keepAlive = setInterval(() => {}, 2 ** 30);
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(keepAlive);
        resolve();
      },
      { once: true }
    );
  });
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error | null)?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export { main };
