function createMediaReconciliationWorker({
  reconciliationService,
  intervalMs = 15 * 60 * 1000
}: { reconciliationService?: { reconcile(): Promise<unknown> }; intervalMs?: number } = {}) {
  if (!reconciliationService?.reconcile) throw new TypeError('Media reconciliation service is required');
  const service = reconciliationService;
  let stopping = false;
  async function run({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    while (!stopping && !signal?.aborted) {
      await service.reconcile();
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
    runOnce: service.reconcile,
    stop: () => {
      stopping = true;
    }
  });
}

async function main(): Promise<void> {
  if (String(process.env.MEDIA_RECONCILIATION_CLAIM_ENABLED || '').toLowerCase() !== 'true') return;
  const { createDbPool } = await import('../lib/db.ts');
  const { createAttachmentRepository } = await import('../domains/media/attachment-repository.ts');
  const { createMediaJobRepository } = await import('../domains/media/media-job-repository.ts');
  const { createMediaReconciliationService } = await import('../domains/media/media-reconciliation-service.ts');
  const { createMediaStorage } = await import('../domains/media/storage.ts');
  const pool = createDbPool();
  const attachments = createAttachmentRepository({ pool });
  const worker = createMediaReconciliationWorker({
    reconciliationService: createMediaReconciliationService({
      attachmentRepository: attachments,
      jobRepository: createMediaJobRepository({ pool }),
      storage: createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' })
    })
  });
  const controller = new AbortController();
  const shutdown = () => {
    worker.stop();
    controller.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await worker.run({ signal: controller.signal });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error | null)?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export { createMediaReconciliationWorker, main };
