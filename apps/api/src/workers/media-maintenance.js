'use strict';

function createMediaMaintenanceWorker({ maintenanceService, intervalMs = 60_000 } = {}) {
  if (!maintenanceService?.cleanupOnce) throw new TypeError('Media maintenance service is required');
  let stopping = false;
  async function run({ signal } = {}) {
    while (!stopping && !signal?.aborted) {
      await maintenanceService.cleanupOnce();
      await new Promise((resolve) => {
        const timer = setTimeout(done, intervalMs);
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }
  return Object.freeze({ run, runOnce: maintenanceService.cleanupOnce, stop: () => { stopping = true; } });
}

async function main() {
  if (String(process.env.MEDIA_MAINTENANCE_CLAIM_ENABLED || '').toLowerCase() !== 'true') return;
  const { createDbPool } = require('../lib/db');
  const { createAttachmentRepository } = require('../domains/media/attachment-repository');
  const { createMediaJobRepository } = require('../domains/media/media-job-repository');
  const { createMediaMaintenanceService } = require('../domains/media/media-maintenance-service');
  const { createMediaStorage } = require('../domains/media/storage');
  const pool = createDbPool();
  const storage = createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' });
  const worker = createMediaMaintenanceWorker({
    maintenanceService: createMediaMaintenanceService({
      attachmentRepository: createAttachmentRepository({ pool }),
      jobRepository: createMediaJobRepository({ pool }),
      storage
    })
  });
  const controller = new AbortController();
  const shutdown = () => { worker.stop(); controller.abort(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try { await worker.run({ signal: controller.signal }); }
  finally { await pool.end(); }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createMediaMaintenanceWorker, main };
