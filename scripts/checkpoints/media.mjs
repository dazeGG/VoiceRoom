import { pathToFileURL } from 'node:url';
import { assertCheckpointArtifact, assertEvidenceIdentity, readRepositoryArtifact } from './immutable-evidence.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_PROFILES = new Set(['all-off', 'all-on', 'n-1-api', 'rescue']);
const REQUIRED_FAILURES = new Set(['disk-pressure', 'provider-failure', 'livekit-failure', 'attachment-delete-race', 'moderation-rollback']);

export function verifyMediaCheckpoint(value, { expectedSha, resolveArtifact } = {}) {
  if (!value || value.contract !== 'voice-room.media-checkpoint/v1' || value.release !== '2.5.0') throw new Error('Invalid G90 checkpoint contract');
  if (!GIT_SHA.test(value.gitSha || '')) throw new Error('G90 requires an immutable git SHA');
  for (const component of ['api', 'web', 'worker']) if (!SHA256.test(value.digests?.[component] || '')) throw new Error(`G90 requires immutable ${component} digest`);
  for (const checkpoint of ['messaging', 'membership', 'engagement']) if (!value.checkpoints?.[checkpoint]?.verified || !SHA256.test(value.checkpoints[checkpoint].sha256 || '')) throw new Error(`G90 requires verified ${checkpoint} checkpoint`);
  if (!value.rescue?.verified || !SHA256.test(value.rescue.digest || '')) throw new Error('G90 requires the verified rescue digest');
  if (!value.restore?.passed || !value.restore?.hashesVerified || !value.restore?.leasesRecovered) throw new Error('G90 requires a successful coordinated restore proof');
  const predecessors = new Set((value.predecessors || []).filter((item) => item?.verified && SHA256.test(item.sha256 || '')).map((item) => item.goal));
  for (let goal = 1; goal <= 89; goal += 1) if (!predecessors.has(`G${String(goal).padStart(2, '0')}`)) throw new Error(`G90 predecessor G${String(goal).padStart(2, '0')} is missing`);
  const profiles = new Set((value.matrix?.profiles || []).filter((item) => item?.passed).map((item) => item.id));
  for (const profile of REQUIRED_PROFILES) if (!profiles.has(profile)) throw new Error(`G90 profile ${profile} is missing or failed`);
  if (!Array.isArray(value.matrix?.pairwise) || value.matrix.pairwise.length < 3 || value.matrix.pairwise.some((item) => item?.passed !== true)) throw new Error('G90 pairwise matrix is incomplete');
  const failures = new Set((value.failures || []).filter((item) => item?.passed && item?.failClosed && item?.noLeak).map((item) => item.id));
  for (const failure of REQUIRED_FAILURES) if (!failures.has(failure)) throw new Error(`G90 failure proof ${failure} is missing or unsafe`);
  const started = Date.parse(value.observation?.startedAt); const ended = Date.parse(value.observation?.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended - started < 3_600_000) throw new Error('G90 observation must be at least 60 minutes');
  if ((value.observation?.authLeaks ?? 1) !== 0 || (value.observation?.missingFiles ?? 1) !== 0 || (value.observation?.unboundedQueues ?? 1) !== 0) throw new Error('G90 observation contains a stop condition');
  if (!Array.isArray(value.stopDefects) || value.stopDefects.length !== 0 || !SHA256.test(value.evidenceChainSha256 || '')) throw new Error('G90 evidence chain is incomplete');
  assertCheckpointArtifact(value, resolveArtifact);
  assertEvidenceIdentity(value, expectedSha);
  return Object.freeze({ gitSha: value.gitSha, durationMs: ended - started, profiles: [...profiles].sort() });
}

function cli() {
  const index = process.argv.indexOf('--verify'); const file = process.argv[index + 1] || process.env.G90_CHECKPOINT_FILE;
  if (index < 0 || !file) throw new Error('Usage: node scripts/checkpoints/media.mjs --verify <checkpoint.json>');
  process.stdout.write(`${JSON.stringify({ ok: true, ...verifyMediaCheckpoint(readRepositoryArtifact(file).value, { expectedSha: process.env.GITHUB_SHA }) })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
