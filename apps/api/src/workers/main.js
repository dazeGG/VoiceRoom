'use strict';

const { startWorkerMetricsServer } = require('../lib/worker-metrics-server');
const { startWorkerHeartbeat } = require('../platform/worker-heartbeat');
const { LOG_EVENTS } = require('../lib/log-events');
const { createLogger } = require('../lib/logger');

const workers = Object.freeze({
  'media-maintenance': require('./media-maintenance').main,
  'media-processing': require('./media-processing').main,
  'media-reconciliation': require('./media-reconciliation').main,
  'message-delivery': require('./message-delivery').main,
  'notification-delivery': require('./notification-delivery').main
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
