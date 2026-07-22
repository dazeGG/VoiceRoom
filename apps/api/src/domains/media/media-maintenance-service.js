'use strict';

function createMediaMaintenanceService({ attachmentRepository, jobRepository, storage, batchSize = 500 } = {}) {
  if (!attachmentRepository || !storage) throw new TypeError('Media maintenance dependencies are required');

  async function cleanupOnce() {
    const temporaryFilesRemoved = storage.removeStaleTemporaryFiles
      ? await storage.removeStaleTemporaryFiles(new Date(Date.now() - 60 * 60 * 1000), { limit: Math.min(500, batchSize) })
      : [];
    const candidates = await attachmentRepository.listCleanupCandidates({ limit: Math.min(500, batchSize) });
    let removed = 0;
    for (const candidate of candidates) {
      const deleted = await attachmentRepository.markCleanupDeleted(candidate.id);
      if (!deleted) continue;
      await storage.removeAttachment(candidate.id).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      await attachmentRepository.clearPhysicalData(candidate.id);
      removed += 1;
      if (removed % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    const jobsRemoved = jobRepository?.removeTerminalBefore
      ? await jobRepository.removeTerminalBefore(new Date(Date.now() - 60 * 60 * 1000), { limit: Math.min(500, batchSize) })
      : [];
    return Object.freeze({
      inspected: candidates.length,
      jobsRemoved: jobsRemoved.length,
      removed,
      temporaryFilesRemoved: temporaryFilesRemoved.length
    });
  }

  return Object.freeze({ cleanupOnce });
}

module.exports = { createMediaMaintenanceService };
