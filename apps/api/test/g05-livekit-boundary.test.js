'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

test('G05-A01 strict boundary proof rejects green status for same-token replay in approved topology', async () => {
  const { runReplayScenario } = await import('../../../scripts/lkv/run-replay-scenario.mjs');
  const { runStrictBoundaryProof } = await import('../../../scripts/lkv/run-strict-boundary-proof.mjs');

  const replay = runReplayScenario();
  const proof = runStrictBoundaryProof({ replay });

  assert.equal(proof.approvedShape.provider, 'livekit/livekit-server:v1.13.2');
  assert.equal(proof.approvedShape.topology, 'docker-compose.lkv.yml');
  assert.equal(proof.replaySummary.sameTokenReconnectAccepted, true);
  assert.equal(proof.status, 'BLOCKED_FOR_AMENDMENT');
  assert.equal(proof.greenF11Allowed, false);
  assert.equal(proof.amendmentRequired, true);
  assert.equal(proof.successorStartAllowed, false);
});

test('G05-A02 proof distinguishes approved-shape failures from material architecture changes', async () => {
  const { runStrictBoundaryProof } = await import('../../../scripts/lkv/run-strict-boundary-proof.mjs');
  const proof = runStrictBoundaryProof();

  const approvedShapeAttempts = proof.attempts.filter((attempt) => !attempt.materialChangeRequired);
  assert.ok(approvedShapeAttempts.length >= 3);
  for (const attempt of approvedShapeAttempts) {
    assert.equal(attempt.denied, false);
    assert.match(attempt.reason, /(reconnect|bounded replay|already accepted|already issued)/i);
  }

  const material = proof.attempts.find((attempt) => attempt.materialChangeRequired);
  assert.ok(material);
  assert.equal(material.denied, true);
  assert.match(material.reason, /changes the approved topology\/provider\/credential architecture/);
  assert.equal(proof.amendmentPath, 'docs/releases/2.5.0/amendments/G05-STRICT-LKV.json');
});

test('G05 ADR records accepted external auth-gate amendment and no successor start before restarted proof', () => {
  const adr = fs.readFileSync('docs/ADR_LIVEKIT_CREDENTIAL_BOUNDARY.md', 'utf8');
  assert.match(adr, /Accepted G05 amendment: external auth-gate selected/);
  assert.match(adr, /sole public WSS gate/);
  assert.match(adr, /LiveKit `7880` is internal-only/);
  assert.match(adr, /separate signed gate credential/);
  assert.match(adr, /PostgreSQL room credential epochs/);
  assert.match(adr, /G06 and later successors remain blocked/);
});

test('G05 amendment artifact binds exact gate invariants and canonical digests', () => {
  const amendment = JSON.parse(fs.readFileSync('docs/releases/2.5.0/amendments/G05-STRICT-LKV.json', 'utf8'));

  assert.equal(amendment.status, 'APPROVED_AMENDMENT');
  assert.equal(amendment.selectedMechanism, 'external-auth-gate');
  assert.equal(amendment.boundedReplayAccepted, false);
  assert.equal(amendment.successorStartAllowedBeforeGreenG05, false);
  assert.deepEqual(
    amendment.approvals.map((approval) => `${approval.role}:${approval.verdict}`),
    ['Planner:APPROVE', 'Architect:APPROVE', 'Critic:APPROVE']
  );
  assert.equal(amendment.invariants.publicWssBoundary, 'sole public WSS gate');
  assert.equal(amendment.invariants.livekitInternalPort, '7880 internal');
  assert.equal(amendment.invariants.guestIdentity, 'account id/room-scoped guest UUID/IP ban-only');
  assert.equal(amendment.invariants.gateCredential, 'separate signed gate credential');
  assert.equal(amendment.invariants.linearization, 'PostgreSQL linearization with epoch/no positive cache');
  assert.equal(amendment.invariants.availabilityPolicy, 'security>availability');
  assert.equal(amendment.invariants.revokeOrdering, 'revoke commit before RemoveParticipant/success');
  assert.deepEqual(amendment.hostileTestMatrix, [
    'stolen-token',
    'restart',
    'partition',
    'clock-skew',
    'concurrent-mint-revoke',
    'leave',
    'ban',
    'explicit-revoke',
    'guest-ip-ban-only'
  ]);
});

test('G05 strict proof CLI can fail closed for release gating', () => {
  const result = spawnSync(process.execPath, ['scripts/lkv/run-strict-boundary-proof.mjs', '--json', '--fail-on-blocked'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 2, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.status, 'BLOCKED_FOR_AMENDMENT');
  assert.equal(proof.greenF11Allowed, false);
});
