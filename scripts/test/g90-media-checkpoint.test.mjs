import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyMediaCheckpoint } from '../checkpoints/media.mjs';
import { bindCheckpointFixture, evidenceChainSha256 } from '../checkpoints/immutable-evidence.mjs';

const index = JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json', 'utf8'));
const hash = (character) => `sha256:${character.repeat(64)}`;
function fixture() {
  const value = {
    contract: 'voice-room.media-checkpoint/v1', release: '2.5.0', gitSha: 'a'.repeat(40),
    digests: { api: hash('a'), web: hash('b'), worker: hash('c') },
    checkpoints: {
      messaging: { verified: true, sha256: hash('d') }, membership: { verified: true, sha256: hash('e') }, engagement: { verified: true, sha256: hash('f') }
    },
    rescue: { verified: true, digest: hash('1') },
    restore: { passed: true, hashesVerified: true, leasesRecovered: true },
    predecessors: Array.from({ length: 89 }, (_, position) => ({ goal: `G${String(position + 1).padStart(2, '0')}`, verified: true, sha256: hash(String((position % 6) + 1)) })),
    matrix: {
      profiles: ['all-off', 'all-on', 'n-1-api', 'rescue'].map((id) => ({ id, passed: true })),
      pairwise: ['media+moderation', 'media+notifications', 'rescue+v2.4.2'].map((id) => ({ id, passed: true }))
    },
    failures: ['disk-pressure', 'provider-failure', 'livekit-failure', 'attachment-delete-race', 'moderation-rollback'].map((id) => ({ id, passed: true, failClosed: true, noLeak: true })),
    observation: { startedAt: '2026-08-06T10:00:00.000Z', endedAt: '2026-08-06T11:00:00.000Z', authLeaks: 0, missingFiles: 0, unboundedQueues: 0 },
    stopDefects: [], evidenceChainSha256: ''
  };
  bindCheckpointFixture(value, 'evidence/g90-proof.json'); value.evidenceChainSha256 = evidenceChainSha256(value);
  return value;
}

test('G90-A01 accepts only a complete immutable 60-minute media checkpoint', () => {
  assert.equal(verifyMediaCheckpoint(fixture()).durationMs, 3_600_000);
});

test('G90-A02 rejects missing lineage, unsafe failures, restore gaps and stop conditions', () => {
  const mutations = [
    (value) => { value.checkpoints.messaging.verified = false; }, (value) => { value.rescue.digest = 'mutable'; },
    (value) => { value.restore.leasesRecovered = false; }, (value) => { value.predecessors.pop(); },
    (value) => { value.matrix.profiles[0].passed = false; }, (value) => { value.matrix.pairwise.pop(); },
    (value) => { value.failures[0].noLeak = false; }, (value) => { value.observation.endedAt = '2026-08-06T10:59:59.999Z'; },
    (value) => { value.observation.missingFiles = 1; }, (value) => { value.stopDefects.push({ severity: 'P1' }); }
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); assert.throws(() => verifyMediaCheckpoint(value)); }
});

test('G90 remains pending until immutable external staging evidence is indexed', () => {
  assert.equal(index.g90MediaCheckpoint.status, 'PENDING_EXTERNAL_STAGING');
  assert.equal(index.g90MediaCheckpoint.checkpointArtifactId, null);
  assert.equal(index.g90MediaCheckpoint.observationMinutes, 0);
  assert.equal(index.g90MediaCheckpoint.verifiedAt, null);
});
