import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyMessagingCheckpoint } from '../checkpoints/messaging.mjs';
import { bindCheckpointFixture, evidenceChainSha256 } from '../checkpoints/immutable-evidence.mjs';

const index = JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json', 'utf8'));
const hash = (character) => `sha256:${character.repeat(64)}`;

function fixture() {
  const value = {
    contract: 'voice-room.messaging-checkpoint/v1', release: '2.5.0', codeSha: 'a'.repeat(40),
    digests: { api: hash('a'), web: hash('b'), worker: hash('c') },
    seedManifest: { id: 'messaging-v1', sha256: hash('d') },
    predecessors: Array.from({ length: 41 }, (_, indexValue) => ({ goal: `G${String(indexValue + 1).padStart(2, '0')}`, sha256: hash(((indexValue % 6) + 1).toString()), verified: true })),
    matrix: {
      profiles: ['all-off', 'all-on', 'n-1-api', 'worker-loss'].map((id) => ({ id, passed: true })),
      pairwise: [{ id: 'history+read', passed: true }, { id: 'replies+delivery', passed: true }]
    },
    failures: ['worker-loss', 'duplicate-delivery', 'reordered-stream', 'cursor-tamper', 'active-ban-expiry'].map((id) => ({ id, passed: true, safeDisable: true })),
    observation: { startedAt: '2026-08-06T10:00:00.000Z', endedAt: '2026-08-06T11:00:00.000Z' },
    stopDefects: [], evidenceChainSha256: ''
  };
  bindCheckpointFixture(value, 'evidence/g42-proof.json'); value.evidenceChainSha256 = evidenceChainSha256(value);
  return value;
}

test('G42-A01 accepts only immutable complete predecessor and matrix evidence', () => {
  const result = verifyMessagingCheckpoint(fixture());
  assert.equal(result.durationMs, 3_600_000); assert.equal(result.codeSha, 'a'.repeat(40));
});

test('G42-A02 fails closed on mutable digests, missing predecessors, short observation, unsafe failures and stop defects', () => {
  const cases = [
    (value) => { value.digests.api = 'latest'; },
    (value) => { value.predecessors.pop(); },
    (value) => { value.observation.endedAt = '2026-08-06T10:59:59.999Z'; },
    (value) => { value.failures[0].safeDisable = false; },
    (value) => { value.matrix.pairwise[0].passed = false; },
    (value) => { value.stopDefects.push({ severity: 'P1' }); }
  ];
  for (const mutate of cases) { const candidate = fixture(); mutate(candidate); assert.throws(() => verifyMessagingCheckpoint(candidate)); }
});

test('G42 remains explicitly pending until external immutable staging observation is indexed', () => {
  assert.equal(index.g42MessagingCheckpoint.status, 'PENDING_EXTERNAL_STAGING');
  assert.equal(index.g42MessagingCheckpoint.checkpointArtifactId, null);
  assert.equal(index.g42MessagingCheckpoint.observationMinutes, 0);
  assert.equal(index.g42MessagingCheckpoint.verifiedAt, null);
});
