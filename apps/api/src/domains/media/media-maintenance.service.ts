import type { AttachmentRepository } from './attachment.repository.ts';
import type { MediaJobRepository } from './media-job.repository.ts';
import type { MediaStorage } from './storage.ts';
import { codeOf } from '../../platform/error-code.ts';

export type MediaCleanupResult = Readonly<{
  inspected: number;
  jobsRemoved: number;
  removed: number;
  temporaryFilesRemoved: number;
}>;

function createMediaMaintenanceService({
  attachmentRepository: attachments,
  jobRepository,
  storage: files,
  batchSize = 500
}: {
  attachmentRepository: Pick<
    AttachmentRepository,
    'listCleanupCandidates' | 'markCleanupDeleted' | 'clearPhysicalData'
  >;
  jobRepository: Pick<MediaJobRepository, 'removeTerminalBefore'>;
  storage: Pick<MediaStorage, 'removeAttachment' | 'removeStaleTemporaryFiles'>;
  batchSize?: number;
}) {
  async function cleanupOnce(): Promise<MediaCleanupResult> {
    const temporaryFilesRemoved = await files.removeStaleTemporaryFiles(new Date(Date.now() - 60 * 60 * 1000), {
      limit: Math.min(500, batchSize)
    });
    const candidates = await attachments.listCleanupCandidates({ limit: Math.min(500, batchSize) });
    let removed = 0;
    for (const candidate of candidates) {
      const deleted = await attachments.markCleanupDeleted(candidate.id);
      if (!deleted) continue;
      await files.removeAttachment(candidate.id).catch((error: unknown) => {
        if (codeOf(error) !== 'ENOENT') throw error;
      });
      await attachments.clearPhysicalData(candidate.id);
      removed += 1;
      if (removed % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    const jobsRemoved = await jobRepository.removeTerminalBefore(new Date(Date.now() - 60 * 60 * 1000), {
      limit: Math.min(500, batchSize)
    });
    return Object.freeze({
      inspected: candidates.length,
      jobsRemoved: jobsRemoved.length,
      removed,
      temporaryFilesRemoved: temporaryFilesRemoved.length
    });
  }

  return Object.freeze({ cleanupOnce });
}

export type MediaMaintenanceService = ReturnType<typeof createMediaMaintenanceService>;

export { createMediaMaintenanceService };
