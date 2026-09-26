import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import type { MediaJobRepository } from '../src/domains/media/media-job.repository.ts';
import { createMediaReconciliationService } from '../src/domains/media/media-reconciliation.service.ts';
import type { MediaStorage, MediaVariant } from '../src/domains/media/storage.ts';
import { attachment, fake, mediaJob } from './fakes/index.ts';

test('G79-A01 missing ready files raise P0, orphans are removed and lost processing jobs recover', async () => {
  const unavailable: string[] = [];
  const enqueued: string[] = [];
  const removed: string[] = [];
  const service = createMediaReconciliationService({
    attachmentRepository: fake<AttachmentRepository>({
      async listProcessingWithoutActiveJob() {
        return [attachment({ id: 'processing', internalState: 'processing' })];
      },
      async listStorageKeys() {
        return [{ id: 'ready', keys: ['ready/processed'] }];
      },
      async findById(id) {
        return attachment({ id, internalState: 'ready' });
      },
      async markUnavailable(id) {
        unavailable.push(id);
        return null;
      }
    }),
    jobRepository: fake<MediaJobRepository>({
      async enqueue(id) {
        enqueued.push(id);
        return mediaJob({ attachmentId: id });
      }
    }),
    storage: fake<MediaStorage>({
      async listKeys() {
        return ['orphan/preview'];
      },
      parseStorageKey(key) {
        const [attachmentId = '', variant = 'original'] = String(key).split('/');
        return { attachmentId, variant: variant as MediaVariant };
      },
      async remove(id, variant) {
        removed.push(`${String(id)}/${String(variant)}`);
        return true;
      }
    })
  });
  const result = await service.reconcile();
  assert.equal(result.severity, 'p0');
  assert.equal(result.processingJobsRecovered, 1);
  assert.deepEqual(enqueued, ['processing']);
  assert.deepEqual(unavailable, ['ready']);
  assert.deepEqual(removed, ['orphan/preview']);
});

test('G79-A02 lease loss stops stale repair before DB or file mutation', async () => {
  let mutations = 0;
  const service = createMediaReconciliationService({
    attachmentRepository: fake<AttachmentRepository>({
      async listProcessingWithoutActiveJob() {
        return [attachment({ id: 'processing', internalState: 'processing' })];
      },
      async listStorageKeys() {
        return [];
      }
    }),
    jobRepository: fake<MediaJobRepository>({
      async enqueue() {
        mutations += 1;
        return mediaJob();
      }
    }),
    storage: fake<MediaStorage>({
      async listKeys() {
        return [];
      }
    }),
    async assertLeaseOwned() {
      throw new Error('lease lost');
    }
  });
  await assert.rejects(service.reconcile(), /lease lost/);
  assert.equal(mutations, 0);
});
