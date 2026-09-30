import assert from 'node:assert/strict';
import sharp from 'sharp';
import test from 'node:test';
import { Readable } from 'node:stream';
import type { AttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { MediaJobFenceError, type MediaJobRepository } from '../src/domains/media/media-job.repository.ts';
import type { MediaStorage } from '../src/domains/media/storage.ts';
import { DEFAULTS, createMediaProcessingWorker, retryDelay } from '../src/workers/media-processing.ts';
import { attachment, fake, mediaJob } from './fakes/index.ts';

test('G77-A01 worker defaults, bounded exponential backoff and pressure claim-stop are exact', async () => {
  assert.deepEqual(DEFAULTS, { batchSize: 10, concurrency: 2, leaseMs: 120000, maxAttempts: 5, timeoutMs: 30000 });
  assert.equal(retryDelay(1), 5000);
  assert.equal(retryDelay(20), 15 * 60 * 1000);
  let claims = 0;
  let storageReads = 0;
  const worker = createMediaProcessingWorker({
    attachmentRepository: fake<AttachmentRepository>(),
    storage: fake<MediaStorage>(),
    pressureService: {
      async canClaimWork() {
        return false;
      }
    },
    jobRepository: fake<MediaJobRepository>({
      async oldestPendingAgeMs() {
        storageReads += 1;
        return 42_000;
      },
      async claimBatch() {
        claims += 1;
        return [];
      }
    }),
    observeOldestPending(age) {
      assert.equal(age, 42_000);
    }
  });
  assert.equal(await worker.runOnce(), 0);
  assert.equal(await worker.runOnce(), 0);
  assert.equal(claims, 0);
  assert.equal(storageReads, 2);
});

test('G77-A02 fencing loss cannot publish ready/failed state and processing owns both variants', async () => {
  let failed = 0;
  let observedAge = 0;
  const worker = createMediaProcessingWorker({
    attachmentRepository: fake<AttachmentRepository>({
      async findById() {
        return attachment({ internalState: 'processing' });
      },
      async markFailed() {
        failed += 1;
        return null;
      }
    }),
    storage: fake<MediaStorage>({
      async openRead() {
        throw new MediaJobFenceError();
      }
    }),
    jobRepository: fake<MediaJobRepository>({
      async oldestPendingAgeMs() {
        return 20_000;
      },
      async claimBatch() {
        return [mediaJob({ id: 'j', attachmentId: 'a', createdAt: new Date(Date.now() - 20_000) })];
      },
      async renew() {
        throw new MediaJobFenceError();
      },
      async fail() {
        throw new MediaJobFenceError();
      }
    }),
    observeOldestPending(age) {
      observedAge = Number(age);
    }
  });
  assert.equal(await worker.runOnce(), 1);
  assert.equal(failed, 0);
  assert.ok(observedAge >= 19_000);
});

test('G77-A03 a claimed upload is turned upright into a WebP image and a preview, then completed', async () => {
  // 40x20 pixels stored sideways: EXIF orientation 6 means "rotate 90° to view".
  const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#3366cc' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const saved: Record<string, Buffer> = {};
  let completed: Record<string, unknown> | null = null;
  const worker = createMediaProcessingWorker({
    attachmentRepository: fake<AttachmentRepository>({
      async findById() {
        return attachment({ internalState: 'processing' });
      }
    }),
    storage: fake<MediaStorage>({
      async openRead() {
        return { key: 'att/original', bytes: original.length, stream: Readable.from([original]) };
      },
      async save(id, variant, bytes) {
        const buffer = bytes as Buffer;
        saved[String(variant)] = buffer;
        return { key: `${String(id)}/${String(variant)}`, bytes: buffer.length };
      }
    }),
    jobRepository: fake<MediaJobRepository>({
      async oldestPendingAgeMs() {
        return 0;
      },
      async claimBatch() {
        return [mediaJob({ id: 'job', attachmentId: 'att' })];
      },
      async renew() {
        return mediaJob({ id: 'job', attachmentId: 'att' });
      },
      async completeProcessing(jobId, input) {
        completed = { jobId, ...input.attachmentResult };
        return attachment({ id: 'att' });
      }
    }),
    observeOldestPending() {}
  });
  assert.equal(await worker.runOnce(), 1);
  assert.deepEqual(Object.keys(saved).sort(), ['preview', 'processed']);
  const processed = await sharp(saved.processed).metadata();
  assert.equal(processed.format, 'webp');
  assert.deepEqual([processed.width, processed.height], [20, 40]);
  assert.equal((await sharp(saved.preview).metadata()).format, 'webp');
  assert.deepEqual(completed, {
    jobId: 'job',
    processedStorageKey: 'att/processed',
    previewStorageKey: 'att/preview',
    processedBytes: saved.processed?.length,
    previewBytes: saved.preview?.length
  });
});
