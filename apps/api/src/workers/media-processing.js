'use strict';

const crypto = require('node:crypto');
const sharp = require('sharp');
const { MediaJobFenceError } = require('../domains/media/media-job-repository');

const DEFAULTS = Object.freeze({ batchSize: 10, concurrency: 2, leaseMs: 120_000, maxAttempts: 5, timeoutMs: 30_000 });

function retryDelay(attempts) {
  return Math.min(15 * 60 * 1000, 5_000 * (2 ** Math.max(0, attempts - 1)));
}

function timeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Media processing timed out');
        error.code = 'media_processing_timeout';
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function transform(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > 10 * 1024 * 1024) throw new Error('Media source exceeds the processing limit');
    chunks.push(value);
  }
  const input = sharp(Buffer.concat(chunks, bytes), {
    failOn: 'warning', limitInputPixels: 40 * 1024 * 1024, sequentialRead: true
  }).rotate();
  const processedPromise = input.clone().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, effort: 4 }).toBuffer();
  const previewPromise = input.clone().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
  const [processed, preview] = await Promise.all([processedPromise, previewPromise]);
  return { preview, processed };
}

function createMediaProcessingWorker({
  attachmentRepository,
  jobRepository,
  pressureService,
  storage,
  workerId = `media-${crypto.randomUUID()}`,
  batchSize = DEFAULTS.batchSize,
  concurrency = DEFAULTS.concurrency,
  leaseMs = DEFAULTS.leaseMs,
  maxAttempts = DEFAULTS.maxAttempts,
  timeoutMs = DEFAULTS.timeoutMs
} = {}) {
  if (!attachmentRepository || !jobRepository || !storage) throw new TypeError('Media processing dependencies are required');
  let stopping = false;

  async function processJob(job) {
    let heartbeat;
    try {
      heartbeat = setInterval(() => {
        void jobRepository.renew(job.id, { workerId, fencingToken: job.fencingToken, leaseMs }).catch(() => {});
      }, Math.max(1_000, Math.floor(leaseMs / 3)));
      heartbeat.unref?.();
      const attachment = await attachmentRepository.findById(job.attachmentId);
      if (!attachment || attachment.internalState !== 'processing') {
        await jobRepository.complete(job.id, { workerId, fencingToken: job.fencingToken });
        return;
      }
      const source = await storage.openRead(job.attachmentId, 'original');
      const output = await timeout(transform(source.stream), timeoutMs);
      const processed = await storage.save(job.attachmentId, 'processed', output.processed);
      const preview = await storage.save(job.attachmentId, 'preview', output.preview);
      await jobRepository.completeProcessing(job.id, {
        workerId,
        fencingToken: job.fencingToken,
        attachmentRepository,
        attachmentResult: {
          processedStorageKey: processed.key,
          previewStorageKey: preview.key,
          processedBytes: processed.bytes,
          previewBytes: preview.bytes
        }
      });
    } catch (error) {
      if (error instanceof MediaJobFenceError || error?.code === 'MEDIA_JOB_FENCE_LOST') return;
      try {
        const failed = await jobRepository.fail(job.id, {
          workerId,
          fencingToken: job.fencingToken,
          error,
          retryDelayMs: retryDelay(job.attempts),
          maxAttempts
        });
        if (failed.state === 'dead') await attachmentRepository.markFailed(job.attachmentId, error?.code || 'media_processing_failed');
      } catch (failure) {
        if (!(failure instanceof MediaJobFenceError)) throw failure;
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function runOnce() {
    if (stopping || (pressureService && !await pressureService.canClaimWork())) return 0;
    const jobs = await jobRepository.claimBatch({ workerId, limit: batchSize, leaseMs });
    for (let offset = 0; offset < jobs.length; offset += concurrency) {
      await Promise.all(jobs.slice(offset, offset + concurrency).map(processJob));
      if (stopping) break;
    }
    return jobs.length;
  }

  async function run({ idleMs = 1_000, signal } = {}) {
    while (!stopping && !signal?.aborted) {
      const count = await runOnce();
      if (!count) await delay(idleMs, signal);
    }
  }

  return Object.freeze({ run, runOnce, stop: () => { stopping = true; } });
}

async function main() {
  if (String(process.env.MEDIA_PROCESSING_CLAIM_ENABLED || '').toLowerCase() !== 'true') return;
  const { createDbPool } = require('../lib/db');
  const { createAttachmentRepository } = require('../domains/media/attachment-repository');
  const { createMediaJobRepository } = require('../domains/media/media-job-repository');
  const { createMediaPressureService } = require('../domains/media/media-pressure-service');
  const { createMediaStorage } = require('../domains/media/storage');
  const pool = createDbPool();
  const storage = createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' });
  await storage.freeSpace();
  const worker = createMediaProcessingWorker({
    attachmentRepository: createAttachmentRepository({ pool }),
    jobRepository: createMediaJobRepository({ pool }),
    pressureService: createMediaPressureService({ storagePath: storage.root }),
    storage
  });
  const controller = new AbortController();
  const shutdown = () => { worker.stop(); controller.abort(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try { await worker.run({ signal: controller.signal }); }
  finally { await pool.end(); }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULTS, createMediaProcessingWorker, main, retryDelay, transform };
