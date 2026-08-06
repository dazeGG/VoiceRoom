import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyMembershipCheckpoint } from '../checkpoints/membership.mjs';
import { bindCheckpointFixture, evidenceChainSha256 } from '../checkpoints/immutable-evidence.mjs';

const index = JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json', 'utf8'));
const hash = (character) => `sha256:${character.repeat(64)}`;

function fixture() {
  const value = {
    contract: 'voice-room.membership-checkpoint/v1', release: '2.5.0', gitSha: 'a'.repeat(40),
    digests: { api: hash('a'), web: hash('b'), worker: hash('c') },
    messagingCheckpoint: { artifactId: 'g42', sha256: hash('d'), verified: true },
    predecessors: Array.from({ length: 49 }, (_, indexValue) => ({ goal: `G${String(indexValue + 1).padStart(2, '0')}`, sha256: hash(((indexValue % 6) + 1).toString()), verified: true })),
    matrix: {
      profiles: ['all-off', 'all-on', 'n-1-api', 'stale-replica', 'rescue'].map((id) => ({ id, passed: true })),
      pairwise: [{ id: 'membership+messaging', passed: true }, { id: 'directory+strict-credential', passed: true }]
    },
    compatibility: ['v2.4.2-client', 'owner-quota', 'visible-rooms', 'summary-recipient', 'directory-leave-rejoin'].map((id) => ({ id, passed: true })),
    strictTokenCorpus: ['leave', 'ban', 'explicit-revoke', 'restart', 'partition'].map((id) => ({ id, sameTokenDenied: true, failClosed: true })),
    observation: { startedAt: '2026-08-06T10:00:00.000Z', endedAt: '2026-08-06T11:00:00.000Z' },
    stopDefects: [], evidenceChainSha256: ''
  };
  bindCheckpointFixture(value, 'evidence/g50-proof.json'); value.evidenceChainSha256 = evidenceChainSha256(value);
  return value;
}

test('G50-A01 accepts only immutable complete membership evidence', () => {
  const result = verifyMembershipCheckpoint(fixture());
  assert.equal(result.durationMs, 3_600_000);
  assert.equal(result.gitSha, 'a'.repeat(40));
});

test('G50-A02 fails closed on missing chain, compatibility, token denial, matrix or observation proof', () => {
  const cases = [
    (value) => { value.messagingCheckpoint.verified = false; },
    (value) => { value.predecessors.pop(); },
    (value) => { value.compatibility.pop(); },
    (value) => { value.strictTokenCorpus[0].sameTokenDenied = false; },
    (value) => { value.matrix.profiles[0].passed = false; },
    (value) => { value.observation.endedAt = '2026-08-06T10:59:59.999Z'; },
    (value) => { value.stopDefects.push({ severity: 'P1' }); }
  ];
  for (const mutate of cases) {
    const candidate = fixture(); mutate(candidate);
    assert.throws(() => verifyMembershipCheckpoint(candidate));
  }
});

test('G50 remains explicitly pending until external immutable staging observation is indexed', () => {
  assert.equal(index.g50MembershipCheckpoint.status, 'PENDING_EXTERNAL_STAGING');
  assert.equal(index.g50MembershipCheckpoint.checkpointArtifactId, null);
  assert.equal(index.g50MembershipCheckpoint.observationMinutes, 0);
  assert.equal(index.g50MembershipCheckpoint.verifiedAt, null);
});
