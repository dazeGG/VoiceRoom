import { pathToFileURL } from 'node:url';
import { assertCheckpointArtifact, assertEvidenceIdentity, readRepositoryArtifact } from './immutable-evidence.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_PROFILES = new Set(['all-off', 'all-on', 'n-1-api', 'stale-replica', 'rescue']);
const REQUIRED_COMPATIBILITY = new Set(['v2.4.2-client', 'owner-quota', 'visible-rooms', 'summary-recipient', 'directory-leave-rejoin']);
const REQUIRED_REVOCATIONS = new Set(['leave', 'ban', 'explicit-revoke', 'restart', 'partition']);

function isoMillis(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function verifyMembershipCheckpoint(value, { expectedSha, resolveArtifact } = {}) {
  if (!value || value.contract !== 'voice-room.membership-checkpoint/v1' || value.release !== '2.5.0') throw new Error('Invalid G50 checkpoint contract');
  if (!GIT_SHA.test(value.gitSha || '')) throw new Error('G50 requires an immutable git SHA');
  for (const component of ['api', 'web', 'worker']) {
    if (!SHA256.test(value.digests?.[component] || '')) throw new Error(`G50 requires immutable ${component} digest`);
  }
  if (!SHA256.test(value.messagingCheckpoint?.sha256 || '') || value.messagingCheckpoint?.verified !== true) throw new Error('G50 requires a verified immutable G42 checkpoint');
  const predecessors = new Set((value.predecessors || []).filter((item) => item?.verified === true && SHA256.test(item.sha256 || '')).map((item) => item.goal));
  for (let goal = 1; goal <= 49; goal += 1) {
    const id = `G${String(goal).padStart(2, '0')}`;
    if (!predecessors.has(id)) throw new Error(`G50 predecessor ${id} is missing`);
  }
  const profiles = new Set((value.matrix?.profiles || []).filter((item) => item?.passed === true).map((item) => item.id));
  for (const id of REQUIRED_PROFILES) if (!profiles.has(id)) throw new Error(`G50 profile ${id} is missing or failed`);
  if (!Array.isArray(value.matrix?.pairwise) || value.matrix.pairwise.length < 2 || value.matrix.pairwise.some((item) => item?.passed !== true)) throw new Error('G50 pairwise matrix is incomplete');
  const compatibility = new Set((value.compatibility || []).filter((item) => item?.passed === true).map((item) => item.id));
  for (const id of REQUIRED_COMPATIBILITY) if (!compatibility.has(id)) throw new Error(`G50 compatibility proof ${id} is missing or failed`);
  const revocations = new Set((value.strictTokenCorpus || []).filter((item) => item?.sameTokenDenied === true && item?.failClosed === true).map((item) => item.id));
  for (const id of REQUIRED_REVOCATIONS) if (!revocations.has(id)) throw new Error(`G50 strict token proof ${id} is missing or unsafe`);
  const startedAt = isoMillis(value.observation?.startedAt);
  const endedAt = isoMillis(value.observation?.endedAt);
  if (startedAt === null || endedAt === null || endedAt - startedAt < 60 * 60 * 1000) throw new Error('G50 observation must be at least 60 minutes');
  if (!Array.isArray(value.stopDefects) || value.stopDefects.length !== 0) throw new Error('G50 contains stop defects');
  if (!SHA256.test(value.evidenceChainSha256 || '')) throw new Error('G50 evidence chain checksum is missing');
  assertCheckpointArtifact(value, resolveArtifact);
  assertEvidenceIdentity(value, expectedSha);
  return Object.freeze({ gitSha: value.gitSha, durationMs: endedAt - startedAt, profiles: [...profiles].sort() });
}

function cli() {
  const verifyIndex = process.argv.indexOf('--verify');
  if (verifyIndex < 0) throw new Error('Usage: node scripts/checkpoints/membership.mjs --verify <checkpoint.json>');
  const file = process.argv[verifyIndex + 1] || process.env.G50_CHECKPOINT_FILE;
  if (!file) throw new Error('G50_CHECKPOINT_FILE or checkpoint path is required');
  const result = verifyMembershipCheckpoint(readRepositoryArtifact(file).value, { expectedSha: process.env.GITHUB_SHA });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
