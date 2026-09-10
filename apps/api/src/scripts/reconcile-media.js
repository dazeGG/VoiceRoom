'use strict';

const { createDbPool } = require('../lib/db');
const { createAttachmentRepository } = require('../domains/media/attachment-repository');
const { createMediaReconciliationService } = require('../domains/media/media-reconciliation-service');
const { createMediaJobRepository } = require('../domains/media/media-job-repository');
const { createMediaStorage } = require('../domains/media/storage');

async function main() {
  const pool = createDbPool();
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
