import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MIN_FREE_BYTES, DEFAULT_RECOVERY_BYTES, createMediaPressureService } from '../src/domains/media/media-pressure-service.ts';
import { recordMediaPressure, renderPrometheus, resetMetricsForTest } from '../src/lib/metrics.ts';

test('G80-A01 2GiB boundary, claim stop and recovery hysteresis fail closed', async () => {
  let free = DEFAULT_MIN_FREE_BYTES - 1;
  const pressure = createMediaPressureService({ storagePath: '/media', statfs: async () => ({ bavail: free, bsize: 1 }), checkIntervalMs: 0 });
  assert.equal((await pressure.measure({ force: true })).healthy, false);
  await assert.rejects(pressure.assertAcceptingUploads(), (error: { code?: string; statusCode?: number; message?: string }) => error.statusCode === 503 && error.code === 'MEDIA_PRESSURE');
  assert.equal(await pressure.canClaimWork(), false);
  free = DEFAULT_MIN_FREE_BYTES + DEFAULT_RECOVERY_BYTES - 1;
  assert.equal((await pressure.measure({ force: true })).healthy, false);
  free += 1;
  assert.equal((await pressure.measure({ force: true })).healthy, true);
  resetMetricsForTest(); recordMediaPressure(pressure.getSnapshot());
  assert.match(renderPrometheus(), /voice_room_api_media_pressure_healthy\{reason="ready"\} 1/);
});

test('G80-A02 replica disagreement disables uploads despite healthy local statfs and requires a fresh agreeing check', async () => {
  let consensus = false;
  const pressure = createMediaPressureService({
    storagePath: '/media', checkIntervalMs: 0, statfs: async () => ({ bavail: DEFAULT_MIN_FREE_BYTES + DEFAULT_RECOVERY_BYTES, bsize: 1 }),
    replicaConsensus: async () => consensus
  });
  const disagreed = await pressure.measure({ force: true });
  assert.equal(disagreed.healthy, false); assert.equal(disagreed.reason, 'replica_disagreement');
  consensus = true;
  assert.equal((await pressure.measure({ force: true })).healthy, true);
  const registry = require('node:fs').readFileSync(fileURLToPath(new URL('../src/app/service-registry.ts', import.meta.url)), 'utf8');
  assert.match(registry, /replicaConsensus: \(\) => readinessProvider\.getSnapshot\(\)\?\.replicaConsensus === true/);
});
