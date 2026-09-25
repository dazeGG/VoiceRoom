import type pg from 'pg';
function createMediaMaintenanceWorker({
  maintenanceService,
  intervalMs = 60_000
}: { maintenanceService?: { cleanupOnce(): Promise<unknown> }; intervalMs?: number } = {}) {
  if (!maintenanceService?.cleanupOnce) throw new TypeError('Media maintenance service is required');
  const service = maintenanceService;
  let stopping = false;
  async function run({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    while (!stopping && !signal?.aborted) {
      await service.cleanupOnce();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, intervalMs);
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          resolve();
        }
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }
  return Object.freeze({
    run,
    runOnce: service.cleanupOnce,
    stop: () => {
      stopping = true;
    }
  });
}

async function main(env: NodeJS.ProcessEnv, pool: pg.Pool): Promise<void> {
  if (String(env.MEDIA_MAINTENANCE_CLAIM_ENABLED || '').toLowerCase() !== 'true') return;
  const { createAttachmentRepository } = await import('../domains/media/attachment-repository.ts');
  const { createMediaJobRepository } = await import('../domains/media/media-job-repository.ts');
  const { createMediaMaintenanceService } = await import('../domains/media/media-maintenance-service.ts');
  const { createMediaStorage } = await import('../domains/media/storage.ts');
  const storage = createMediaStorage({ rootDir: env.MEDIA_STORAGE_DIR || '/data/media' });
  const worker = createMediaMaintenanceWorker({
    maintenanceService: createMediaMaintenanceService({
      attachmentRepository: createAttachmentRepository({ pool }),
      jobRepository: createMediaJobRepository({ pool }),
      storage
    })
  });
  const controller = new AbortController();
  const shutdown = () => {
    worker.stop();
    controller.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await worker.run({ signal: controller.signal });
}

export { createMediaMaintenanceWorker, main };
