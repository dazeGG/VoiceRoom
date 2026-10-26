import type pg from 'pg';
import { readWorkerConfig } from '../app/config.ts';
import type { MediaMaintenanceService } from '../domains/media/media-maintenance.service.ts';

function createMediaMaintenanceWorker({
  maintenanceService: service,
  intervalMs = 60_000
}: {
  maintenanceService: Pick<MediaMaintenanceService, 'cleanupOnce'>;
  intervalMs?: number;
}) {
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
    runOnce: () => service.cleanupOnce(),
    stop: () => {
      stopping = true;
    }
  });
}

async function main(env: NodeJS.ProcessEnv, pool: pg.Pool): Promise<void> {
  const config = readWorkerConfig(env);
  if (!config.MEDIA_MAINTENANCE_CLAIM_ENABLED) return;
  const { createAttachmentRepository } = await import('../domains/media/attachment.repository.ts');
  const { createMediaJobRepository } = await import('../domains/media/media-job.repository.ts');
  const { createMediaMaintenanceService } = await import('../domains/media/media-maintenance.service.ts');
  const { createMediaStorage } = await import('../domains/media/storage.ts');
  const storage = createMediaStorage({ rootDir: config.MEDIA_STORAGE_DIR });
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
