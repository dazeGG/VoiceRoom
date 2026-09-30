import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaMaintenanceService } from '../src/domains/media/media-maintenance.service.ts';
import { createMediaMaintenanceWorker } from '../src/workers/media-maintenance.ts';
import { attachment } from './fakes/index.ts';

test('G78-A01 cleanup is bounded to 500, rechecks candidates and is idempotent', async () => {
  const candidates = Array.from({ length: 500 }, (_, index) => attachment({ id: `a-${index}` }));
  const removed = new Set<string>();
  const service = createMediaMaintenanceService({
    batchSize: 999,
    attachmentRepository: {
      async listCleanupCandidates(options) {
        assert.equal(options?.limit, 500);
        return candidates;
      },
      async markCleanupDeleted(id) {
        if (removed.has(id)) return null;
        removed.add(id);
        return attachment({ id });
      },
      async clearPhysicalData(id) {
        return attachment({ id });
      }
    },
    jobRepository: {
      async removeTerminalBefore(_before, options) {
        assert.equal(options?.limit, 500);
        return [];
      }
    },
    storage: {
      async removeStaleTemporaryFiles(_before, options) {
        assert.equal(options?.limit, 500);
        return [];
      },
      async removeAttachment() {
        return true;
      }
    }
  });
  const first = await service.cleanupOnce();
  const second = await service.cleanupOnce();
  assert.equal(first.removed, 500);
  assert.equal(second.removed, 0);
});

test('G78-A02 worker shutdown interrupts its wait', async () => {
  let runs = 0;
  const worker = createMediaMaintenanceWorker({
    maintenanceService: {
      async cleanupOnce() {
        runs += 1;
        return {};
      }
    },
    intervalMs: 60000
  });
  const controller = new AbortController();
  const running = worker.run({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await running;
  assert.equal(runs, 1);
});
