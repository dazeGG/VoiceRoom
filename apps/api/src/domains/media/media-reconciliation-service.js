'use strict';

function createMediaReconciliationService({ attachmentRepository, storage, assertLeaseOwned = async () => true } = {}) {
  if (!attachmentRepository || !storage) throw new TypeError('Media reconciliation dependencies are required');

  async function reconcile() {
    const databaseKeys = new Map();
    let afterId = null;
    for (;;) {
      const page = await attachmentRepository.listStorageKeys({ afterId, limit: 500 });
      for (const row of page) for (const key of row.keys) databaseKeys.set(key, row.id);
      if (page.length < 500) break;
      afterId = page.at(-1).id;
    }
    const fileKeys = new Set(await storage.listKeys());
    const missingAttachmentIds = new Set();
    for (const [key, attachmentId] of databaseKeys) if (!fileKeys.has(key)) missingAttachmentIds.add(attachmentId);
    let markedUnavailable = 0;
    for (const id of missingAttachmentIds) {
      await assertLeaseOwned();
      const attachment = await attachmentRepository.findById(id);
      if (attachment?.internalState === 'ready') {
        await attachmentRepository.markUnavailable(id, 'media_missing');
        markedUnavailable += 1;
      }
    }
    let orphanFilesRemoved = 0;
    for (const key of fileKeys) {
      if (databaseKeys.has(key)) continue;
      await assertLeaseOwned();
      const parsed = storage.parseStorageKey(key);
      if (await storage.remove(parsed.attachmentId, parsed.variant)) orphanFilesRemoved += 1;
    }
    return Object.freeze({
      databaseFiles: databaseKeys.size,
      filesystemFiles: fileKeys.size,
      markedUnavailable,
      orphanFilesRemoved,
      severity: markedUnavailable > 0 ? 'p0' : 'ok'
    });
  }

  return Object.freeze({ reconcile });
}

module.exports = { createMediaReconciliationService };
