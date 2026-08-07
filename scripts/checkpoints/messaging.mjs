import { pathToFileURL } from 'node:url';
import { assertCheckpointArtifact, assertEvidenceIdentity, readExternalCliArtifact } from './immutable-evidence.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_PROFILES = new Set(['all-off', 'all-on', 'n-1-api', 'worker-loss']);
const REQUIRED_FAILURES = new Set(['worker-loss', 'duplicate-delivery', 'reordered-stream', 'cursor-tamper', 'active-ban-expiry']);

function isoMillis(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function verifyMessagingCheckpoint(value, { expectedSha, resolveArtifact } = {}) {
  if (!value || value.contract !== 'voice-room.messaging-checkpoint/v1' || value.release !== '2.5.0') throw new Error('Invalid G42 checkpoint contract');
  if (!GIT_SHA.test(value.codeSha || '')) throw new Error('G42 requires an immutable evaluated code SHA');
  for (const component of ['api', 'web', 'worker']) {
    if (!SHA256.test(value.digests?.[component] || '')) throw new Error(`G42 requires immutable ${component} digest`);
  }
  if (!SHA256.test(value.seedManifest?.sha256 || '') || !value.seedManifest?.id) throw new Error('G42 requires a versioned seed manifest');
  const predecessorGoals = new Set((value.predecessors || []).filter((item) => item?.verified === true && SHA256.test(item.sha256 || '')).map((item) => item.goal));
  for (let goal = 1; goal <= 41; goal += 1) if (!predecessorGoals.has(`G${String(goal).padStart(2, '0')}`)) throw new Error(`G42 predecessor G${String(goal).padStart(2, '0')} is missing`);
  const profiles = new Set((value.matrix?.profiles || []).filter((item) => item?.passed === true).map((item) => item.id));
  for (const required of REQUIRED_PROFILES) if (!profiles.has(required)) throw new Error(`G42 profile ${required} is missing or failed`);
  if (!Array.isArray(value.matrix?.pairwise) || value.matrix.pairwise.length < 2 || value.matrix.pairwise.some((item) => item?.passed !== true)) throw new Error('G42 pairwise matrix is incomplete');
  const failures = new Set((value.failures || []).filter((item) => item?.passed === true && item?.safeDisable === true).map((item) => item.id));
  for (const required of REQUIRED_FAILURES) if (!failures.has(required)) throw new Error(`G42 hostile failure ${required} is missing or unsafe`);
  const startedAt = isoMillis(value.observation?.startedAt); const endedAt = isoMillis(value.observation?.endedAt);
  if (startedAt === null || endedAt === null || endedAt - startedAt < 60 * 60 * 1000) throw new Error('G42 observation must be at least 60 minutes');
  if (!Array.isArray(value.stopDefects) || value.stopDefects.length !== 0) throw new Error('G42 contains stop defects');
  if (!SHA256.test(value.evidenceChainSha256 || '')) throw new Error('G42 evidence chain checksum is missing');
  assertCheckpointArtifact(value, resolveArtifact);
  assertEvidenceIdentity(value, expectedSha);
  return Object.freeze({ codeSha: value.codeSha, durationMs: endedAt - startedAt, profiles: [...profiles].sort(), failures: [...failures].sort() });
}

function cli() {
  const verifyIndex = process.argv.indexOf('--verify');
  if (verifyIndex < 0) throw new Error('Usage: node scripts/checkpoints/messaging.mjs --verify <checkpoint.json>');
  const file = process.argv[verifyIndex + 1] || process.env.G42_CHECKPOINT_FILE;
  if (!file) throw new Error('G42_CHECKPOINT_FILE or checkpoint path is required');
  const result = verifyMessagingCheckpoint(readExternalCliArtifact(process.argv).value, { expectedSha: process.env.GITHUB_SHA });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
