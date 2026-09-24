// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { MediaJobFenceError } from '../src/domains/media/media-job-repository.ts';
import { DEFAULTS, createMediaProcessingWorker, retryDelay } from '../src/workers/media-processing.ts';

test('G77-A01 worker defaults, bounded exponential backoff and pressure claim-stop are exact', async () => {
  assert.deepEqual(DEFAULTS, { batchSize: 10, concurrency: 2, leaseMs: 120000, maxAttempts: 5, timeoutMs: 30000 });
  assert.equal(retryDelay(1), 5000); assert.equal(retryDelay(20), 15 * 60 * 1000);
  let claims = 0; let storageReads = 0;
  const worker = createMediaProcessingWorker({
    attachmentRepository: {}, storage: {}, pressureService: { async canClaimWork() { return false; } },
    jobRepository: { async oldestPendingAgeMs() { storageReads += 1; return 42_000; }, async claimBatch() { claims += 1; return []; } },
    observeOldestPending(age) { assert.equal(age, 42_000); }
  });
  assert.equal(await worker.runOnce(), 0); assert.equal(await worker.runOnce(), 0); assert.equal(claims, 0); assert.equal(storageReads, 2);
});

test('G77-A02 fencing loss cannot publish ready/failed state and processing owns both variants', async () => {
  let failed = 0; let observedAge = 0;
  const worker = createMediaProcessingWorker({
    attachmentRepository: { async findById() { return { internalState: 'processing' }; }, async markFailed() { failed += 1; } },
    storage: { async openRead() { throw new MediaJobFenceError(); } },
    jobRepository: {
      async oldestPendingAgeMs() { return 20_000; },
      async claimBatch() { return [{ id: 'j', attachmentId: 'a', attempts: 1, fencingToken: 1, createdAt: new Date(Date.now() - 20_000) }]; },
      async renew() { throw new MediaJobFenceError(); }, async fail() { throw new MediaJobFenceError(); }
    }, observeOldestPending(age) { observedAge = age; }
  });
  assert.equal(await worker.runOnce(), 1); assert.equal(failed, 0);
  assert.ok(observedAge >= 19_000);
  const source = fs.readFileSync(fileURLToPath(new URL('../src/workers/media-processing.ts', import.meta.url)), 'utf8');
  assert.match(source, /storage\.save\(job\.attachmentId, 'processed'/);
  assert.match(source, /storage\.save\(job\.attachmentId, 'preview'/);
  assert.match(source, /completeProcessing/);
  assert.match(source, /\.rotate\(\)/);
});
