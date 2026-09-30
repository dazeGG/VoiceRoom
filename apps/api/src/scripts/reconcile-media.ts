import { readDatabaseConfig } from '../lib/config.ts';
import { createDbPool } from '../platform/db/pool.ts';
import { createAttachmentRepository } from '../domains/media/attachment.repository.ts';
import { createMediaReconciliationService } from '../domains/media/media-reconciliation.service.ts';
import { createMediaJobRepository } from '../domains/media/media-job.repository.ts';
import { createMediaStorage } from '../domains/media/storage.ts';

async function main() {
  const pool = createDbPool({ databaseUrl: readDatabaseConfig(process.env).url });
  const storage = createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' });
  const service = createMediaReconciliationService({
    attachmentRepository: createAttachmentRepository({ pool }),
    jobRepository: createMediaJobRepository({ pool }),
    storage
  });
  try {
    const result = await service.reconcile();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.severity === 'p0') process.exitCode = 2;
    return result;
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

export { main };
