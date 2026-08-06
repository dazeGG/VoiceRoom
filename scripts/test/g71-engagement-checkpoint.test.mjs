import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyEngagementCheckpoint } from '../checkpoints/engagement.mjs';
import { bindCheckpointFixture, evidenceChainSha256 } from '../checkpoints/immutable-evidence.mjs';

const index = JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json', 'utf8'));
const hash = (character) => `sha256:${character.repeat(64)}`;

function fixture() {
  const value = {
    contract: 'voice-room.engagement-checkpoint/v1', release: '2.5.0', codeSha: 'a'.repeat(40),
    digests: { api: hash('a'), web: hash('b'), worker: hash('c') },
    messagingCheckpoint: { artifactId: 'g42', sha256: hash('d'), verified: true },
    membershipCheckpoint: { artifactId: 'g50', sha256: hash('e'), verified: true },
    predecessors: Array.from({ length: 70 }, (_, indexValue) => ({ goal: `G${String(indexValue + 1).padStart(2, '0')}`, sha256: hash(((indexValue % 6) + 1).toString()), verified: true })),
    matrix: {
      profiles: ['all-off', 'all-on', 'n-1-api', 'provider-failure', 'worker-loss', 'rescue'].map((id) => ({ id, passed: true })),
      pairwise: ['messaging+membership', 'engagement+reactions', 'notifications+worker-loss'].map((id) => ({ id, passed: true }))
    },
    compatibility: ['v2.4.2-client', 'account-client', 'guest-room-client'].map((id) => ({ id, passed: true })),
    failureProofs: ['provider-failure', 'worker-loss', 'visibility-boundary', 'reordered-events', 'unicode-rgi'].map((id) => ({ id, passed: true, failClosed: true, noLeak: true })),
    budgets: {
      fiveMentionFanout: { p95Ms: 500 }, inboxRead: { p95Ms: 300, p99Ms: 750 },
      notificationWorker: { throughputPerSecond: 100, duplicateDeliveries: 0 }, reactionMutation: { p95Ms: 250 }
    },
    observation: { startedAt: '2026-08-06T10:00:00.000Z', endedAt: '2026-08-06T11:00:00.000Z' },
    stopDefects: [], evidenceChainSha256: ''
  };
  bindCheckpointFixture(value, 'evidence/g71-proof.json'); value.evidenceChainSha256 = evidenceChainSha256(value);
  return value;
}

test('G71-A01 accepts only immutable complete engagement evidence', () => {
  const result = verifyEngagementCheckpoint(fixture());
  assert.equal(result.durationMs, 3_600_000);
  assert.equal(result.codeSha, 'a'.repeat(40));
});

test('G71-A02 fails closed on missing external matrices, budgets, failure thresholds or 60m proof', () => {
  const cases = [
    (value) => { value.messagingCheckpoint.verified = false; },
    (value) => { value.membershipCheckpoint.sha256 = 'mutable'; },
    (value) => { value.predecessors.pop(); },
    (value) => { value.matrix.profiles[0].passed = false; },
    (value) => { value.matrix.pairwise.pop(); },
    (value) => { value.compatibility.pop(); },
    (value) => { value.failureProofs[0].failClosed = false; },
    (value) => { value.failureProofs[1].noLeak = false; },
    (value) => { value.budgets.fiveMentionFanout.p95Ms = 501; },
    (value) => { value.budgets.inboxRead.p99Ms = 751; },
    (value) => { value.budgets.notificationWorker.throughputPerSecond = 99; },
    (value) => { value.budgets.reactionMutation.p95Ms = 251; },
    (value) => { value.observation.endedAt = '2026-08-06T10:59:59.999Z'; },
    (value) => { value.stopDefects.push({ severity: 'P1' }); }
  ];
  for (const mutate of cases) {
    const candidate = fixture();
    mutate(candidate);
    assert.throws(() => verifyEngagementCheckpoint(candidate));
  }
});

test('G71 remains pending until immutable external staging evidence is indexed', () => {
  assert.equal(index.g71EngagementCheckpoint.status, 'PENDING_EXTERNAL_STAGING');
  assert.equal(index.g71EngagementCheckpoint.checkpointArtifactId, null);
  assert.equal(index.g71EngagementCheckpoint.observationMinutes, 0);
  assert.equal(index.g71EngagementCheckpoint.verifiedAt, null);
});
