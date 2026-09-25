import type { AttachmentRepository } from './attachment-repository.ts';
import type { MediaJobRepository } from './media-job-repository.ts';
import type { MediaStorage } from './storage.ts';

export type ReconciliationResult = Readonly<{
  databaseFiles: number;
  filesystemFiles: number;
  markedUnavailable: number;
  orphanFilesRemoved: number;
  processingJobsRecovered: number;
  severity: 'p0' | 'ok';
}>;

function createMediaReconciliationService({
  attachmentRepository,
  jobRepository,
  storage,
  assertLeaseOwned = async () => true
}: {
  attachmentRepository?: Pick<AttachmentRepository, 'listStorageKeys' | 'findById' | 'markUnavailable'> &
    Partial<Pick<AttachmentRepository, 'listProcessingWithoutActiveJob'>>;
  jobRepository?: Partial<Pick<MediaJobRepository, 'enqueue'>> | null;
  storage?: Pick<MediaStorage, 'listKeys' | 'parseStorageKey' | 'remove'>;
  assertLeaseOwned?: () => Promise<unknown>;
} = {}) {
  if (!attachmentRepository || !storage) throw new TypeError('Media reconciliation dependencies are required');
  const attachments = attachmentRepository;
  const files = storage;

  async function reconcile(): Promise<ReconciliationResult> {
    let processingJobsRecovered = 0;
    if (jobRepository?.enqueue && attachments.listProcessingWithoutActiveJob) {
      const recoverable = await attachments.listProcessingWithoutActiveJob({ limit: 500 });
      for (const attachment of recoverable) {
        await assertLeaseOwned();
        await jobRepository.enqueue(attachment.id);
        processingJobsRecovered += 1;
      }
    }
    const databaseKeys = new Map<string, string>();
    let afterId: string | null = null;
    for (;;) {
      const page = await attachments.listStorageKeys({ afterId, limit: 500 });
      for (const row of page) for (const key of row.keys) databaseKeys.set(key, row.id);
      if (page.length < 500) break;
      afterId = page.at(-1)!.id;
    }
    const fileKeys = new Set(await files.listKeys());
    const missingAttachmentIds = new Set<string>();
    for (const [key, attachmentId] of databaseKeys) if (!fileKeys.has(key)) missingAttachmentIds.add(attachmentId);
    let markedUnavailable = 0;
    for (const id of missingAttachmentIds) {
      await assertLeaseOwned();
      const attachment = await attachments.findById(id);
      if (attachment?.internalState === 'ready') {
        await attachments.markUnavailable(id, 'media_missing');
        markedUnavailable += 1;
      }
    }
    let orphanFilesRemoved = 0;
    for (const key of fileKeys) {
      if (databaseKeys.has(key)) continue;
      await assertLeaseOwned();
      const parsed = files.parseStorageKey(key);
      if (await files.remove(parsed.attachmentId, parsed.variant)) orphanFilesRemoved += 1;
    }
    return Object.freeze({
      databaseFiles: databaseKeys.size,
      filesystemFiles: fileKeys.size,
      markedUnavailable,
      orphanFilesRemoved,
      processingJobsRecovered,
      severity: markedUnavailable > 0 ? 'p0' : 'ok'
    });
  }

  return Object.freeze({ reconcile });
}

export { createMediaReconciliationService };
