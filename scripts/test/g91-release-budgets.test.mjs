import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyBudgetEvidence, verifyBudgetProfile } from '../perf/g91-release-budgets.mjs';

const profile = JSON.parse(fs.readFileSync('scripts/perf/release-250-profile.v1.json', 'utf8'));
function evidence() {
  return {
    gitSha: 'a'.repeat(40), apiDigest: `sha256:${'a'.repeat(64)}`, webDigest: `sha256:${'b'.repeat(64)}`, workerDigest: `sha256:${'c'.repeat(64)}`,
    hardware: { cpu: 'fixture', memoryBytes: 1 }, database: { engine: 'postgresql', version: 'fixture' }, concurrency: { clients: 1 },
    startedAt: '2026-08-06T10:00:00.000Z', endedAt: '2026-08-06T11:00:00.000Z', metricLabels: ['status', 'operation'], alertsVerified: true, autoDisableVerified: true,
    measurements: Object.fromEntries(Object.entries(profile.budgets).map(([surface, limits]) => [surface, { ...limits }]))
  };
}

test('G91-A01 frozen profile and immutable evidence satisfy exact release budgets', () => {
  assert.equal(verifyBudgetProfile(profile), true);
  assert.equal(verifyBudgetEvidence(profile, evidence()).status, 'VERIFIED');
});

test('G91-A02 missing measurements, weakened profile, identity labels and absent controls fail closed', () => {
  const weak = structuredClone(profile); weak.budgets.roomHistory.p95Ms = 301;
  assert.throws(() => verifyBudgetProfile(weak), /changed/);
  for (const mutate of [
    (value) => { delete value.measurements.mediaRead; },
    (value) => { value.measurements.roomHistory.p95Ms = 301; },
    (value) => { value.metricLabels.push('room_id'); },
    (value) => { value.alertsVerified = false; },
    (value) => { value.autoDisableVerified = false; },
    (value) => { value.apiDigest = 'mutable'; }
  ]) { const value = evidence(); mutate(value); assert.throws(() => verifyBudgetEvidence(profile, value)); }
});
