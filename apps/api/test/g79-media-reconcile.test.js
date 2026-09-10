'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createMediaReconciliationService } = require('../src/domains/media/media-reconciliation-service');

test('G79-A01 missing ready files raise P0, orphans are removed and lost processing jobs recover', async () => {
  const unavailable = []; const enqueued = []; const removed = [];
  const service = createMediaReconciliationService({
    attachmentRepository: {
      async listProcessingWithoutActiveJob() { return [{ id: 'processing' }]; },
      async listStorageKeys() { return [{ id: 'ready', keys: ['ready/processed'] }]; },
      async findById() { return { internalState: 'ready' }; }, async markUnavailable(id) { unavailable.push(id); }
    },
    jobRepository: { async enqueue(id) { enqueued.push(id); } },
    storage: {
      async listKeys() { return ['orphan/preview']; }, parseStorageKey(key) { const [attachmentId, variant] = key.split('/'); return { attachmentId, variant }; },
      async remove(id, variant) { removed.push(`${id}/${variant}`); return true; }
    }
  });
  const result = await service.reconcile();
  assert.equal(result.severity, 'p0'); assert.equal(result.processingJobsRecovered, 1);
  assert.deepEqual(enqueued, ['processing']); assert.deepEqual(unavailable, ['ready']); assert.deepEqual(removed, ['orphan/preview']);
});

test('G79-A02 lease loss stops stale repair before DB or file mutation', async () => {
  let mutations = 0;
  const service = createMediaReconciliationService({
    attachmentRepository: { async listProcessingWithoutActiveJob() { return [{ id: 'processing' }]; }, async listStorageKeys() { return []; } },
    jobRepository: { async enqueue() { mutations += 1; } }, storage: { async listKeys() { return []; } },
    async assertLeaseOwned() { throw new Error('lease lost'); }
  });
  await assert.rejects(service.reconcile(), /lease lost/); assert.equal(mutations, 0);
});
