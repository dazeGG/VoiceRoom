import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA256 = /^sha256:[a-f0-9]{64}$/; const GIT_SHA = /^[a-f0-9]{40}$/;
function exactKeys(actual, expected, label) { const a = [...actual].sort(); const e = [...expected].sort(); if (a.length !== e.length || a.some((item, index) => item !== e[index])) throw new Error(`RC ${label} set is incomplete or contains unknown entries`); }
export function verifyRcCandidate(policy, evidence) {
  if (policy?.contract !== 'voice-room.rc-policy/v1' || evidence?.contract !== 'voice-room.rc-candidate/v1' || evidence.release !== policy.release) throw new Error('Invalid RC policy or evidence contract');
  const authority = evidence.g93Authority;
  if (authority?.status !== 'VERIFIED' || !GIT_SHA.test(authority.developSha || '') || !SHA256.test(authority.artifactSha256 || '') || authority.releaseBranchAllowed !== true) throw new Error('Green immutable G93 authority is required');
  if (!authority.mergeMethodAuthority?.id || !SHA256.test(authority.mergeMethodAuthority.sha256 || '')) throw new Error('Release-only merge-method authority is required');
  if (evidence.branch !== policy.branch || evidence.version !== policy.release || evidence.baseDevelopSha !== authority.developSha) throw new Error('RC branch/version/base does not bind G93');
  const candidates = evidence.candidates || []; const active = candidates.filter((item) => item.status === 'active');
  if (active.length !== 1) throw new Error('Exactly one active RC candidate is required');
  const candidate = active[0];
  if (!candidate.id || !Number.isInteger(candidate.ordinal) || candidate.ordinal < 1 || !GIT_SHA.test(candidate.sourceSha || '') || !GIT_SHA.test(candidate.treeSha || '')) throw new Error('Active candidate identity is not immutable');
  exactKeys(Object.keys(candidate.digests || {}), policy.requiredDigests, 'digest');
  for (const [key, digest] of Object.entries(candidate.digests)) if (!SHA256.test(digest || '')) throw new Error(`RC ${key} digest is mutable`);
  const ordinals = candidates.map((item) => item.ordinal); if (new Set(ordinals).size !== ordinals.length || [...ordinals].sort((a,b) => a-b).some((value, index) => value !== index + 1)) throw new Error('RC candidate ordinals must be unique and contiguous');
  if (new Set(candidates.map((item) => item.sourceSha)).size !== candidates.length || new Set(candidates.map((item) => item.treeSha)).size !== candidates.length) throw new Error('Invalidated RC source/tree identities cannot be reused');
  for (const prior of candidates.filter((item) => item !== candidate)) if (prior.status !== 'invalidated' || prior.invalidatedBy !== candidate.id || prior.rebuildRequired !== true || !(prior.ordinal < candidate.ordinal)) throw new Error('Prior candidates must be invalidated and force a rebuild');
  const matrices = evidence.matrices || []; exactKeys(matrices.map((item) => item.id), policy.requiredMatrices, 'matrix');
  for (const matrix of matrices) if (matrix.passed !== true || matrix.candidateId !== candidate.id || !matrix.artifactId || !SHA256.test(matrix.sha256 || '')) throw new Error(`RC matrix ${matrix.id} is missing, stale or failed`);
  for (const [role, verdict] of Object.entries(policy.reviewVerdicts)) { const review = evidence.reviews?.[role]; if (review?.verdict !== verdict || review.sourceSha !== candidate.sourceSha || !SHA256.test(review.sha256 || '')) throw new Error(`RC ${role} review is missing or stale`); }
  if (evidence.productionContacts !== 0 || evidence.productionCredentialReads !== 0 || evidence.productionDeployments !== 0) throw new Error('RC preflight must have zero production side effects');
  return { status: policy.terminalStatus, candidateId: candidate.id, sourceSha: candidate.sourceSha };
}
export function verifyRepositoryCannotAssemble(index, lineage) {
  if (index?.g93DevelopEntry?.status !== 'VERIFIED' || !GIT_SHA.test(index.g93DevelopEntry.terminalDevelopSha || '') || lineage?.terminalDevelopSha !== index.g93DevelopEntry.terminalDevelopSha) throw new Error('RC assembly blocked: G93 exact SHA authority is unavailable');
  throw new Error('RC assembly blocked: no immutable candidate evidence was supplied');
}
function cli() {
  const policy = JSON.parse(fs.readFileSync('config/release/2.5.0-rc-policy.v1.json', 'utf8'));
  if (process.argv.includes('--repo')) verifyRepositoryCannotAssemble(JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json')), JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/bootstrap-lineage.json')));
  const index = process.argv.indexOf('--verify'); if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: --verify <rc-evidence.json> or --repo');
  process.stdout.write(`${JSON.stringify({ ok: true, ...verifyRcCandidate(policy, JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'))) })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
