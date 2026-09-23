import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaMaintenanceService } from '../src/domains/media/media-maintenance-service.ts';
import { createMediaMaintenanceWorker } from '../src/workers/media-maintenance.js';

test('G78-A01 cleanup is bounded to 500, rechecks candidates and is idempotent', async () => {
  const candidates = Array.from({ length: 500 }, (_, index) => ({ id: `a-${index}` }));
  const removed = new Set();
  const service = createMediaMaintenanceService({
    batchSize: 999,
    attachmentRepository: {
      async listCleanupCandidates({ limit }) { assert.equal(limit, 500); return candidates; },
      async markCleanupDeleted(id) { if (removed.has(id)) return null; removed.add(id); return { id }; },
      async clearPhysicalData() {}
    },
    jobRepository: { async removeTerminalBefore(_before, { limit }) { assert.equal(limit, 500); return []; } },
    storage: { async removeStaleTemporaryFiles(_before, { limit }) { assert.equal(limit, 500); return []; }, async removeAttachment() {} }
  });
  const first = await service.cleanupOnce(); const second = await service.cleanupOnce();
  assert.equal(first.removed, 500); assert.equal(second.removed, 0);
});

test('G78-A02 worker shutdown interrupts its wait and retention predicates remain exact', async () => {
  let runs = 0;
  const worker = createMediaMaintenanceWorker({ maintenanceService: { async cleanupOnce() { runs += 1; return {}; } }, intervalMs: 60000 });
  const controller = new AbortController(); const running = worker.run({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve)); controller.abort(); await running;
  assert.equal(runs, 1);
  const source = require('node:fs').readFileSync(fileURLToPath(new URL('../src/domains/media/attachment-repository.ts', import.meta.url)), 'utf8');
  assert.match(source, /state = 'uploading'[\s\S]*interval '1 hour'/);
  assert.match(source, /state = 'failed'[\s\S]*interval '1 hour'/);
  assert.match(source, /state = 'ready'[\s\S]*interval '24 hours'/);
  assert.match(source, /bound_at IS NULL/);
});
