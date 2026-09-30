import type pg from 'pg';
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

async function main(env: NodeJS.ProcessEnv, pool: pg.Pool): Promise<void> {
  if (String(env.MEDIA_RECONCILIATION_CLAIM_ENABLED || '').toLowerCase() !== 'true') return;
  const { createAttachmentRepository } = await import('../domains/media/attachment.repository.ts');
  const { createMediaJobRepository } = await import('../domains/media/media-job.repository.ts');
  const { createMediaReconciliationService } = await import('../domains/media/media-reconciliation.service.ts');
  const { createMediaStorage } = await import('../domains/media/storage.ts');
  const attachments = createAttachmentRepository({ pool });
  const worker = createMediaReconciliationWorker({
    reconciliationService: createMediaReconciliationService({
      attachmentRepository: attachments,
      jobRepository: createMediaJobRepository({ pool }),
      storage: createMediaStorage({ rootDir: env.MEDIA_STORAGE_DIR || '/data/media' })
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

export { createMediaReconciliationWorker, main };
