import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bindExternalFixture, evidenceChainSha256, sha256 } from '../checkpoints/immutable-evidence.mjs';
import { verifyRcCandidate, verifyRepositoryCannotAssemble } from '../release/verify-rc-candidate.mjs';

const policy = JSON.parse(fs.readFileSync('config/release/2.5.0-rc-policy.v1.json'));
const hash = (c) => `sha256:${c.repeat(64)}`;

function fixture() {
  const sourceSha = 'c'.repeat(40); const candidateId = 'rc-1'; const artifacts = new Map();
  const bind = (path, value) => { const bytes = Buffer.from(JSON.stringify(value)); artifacts.set(path, bytes); return { artifactPath: path, sha256: sha256(bytes) }; };
  const digests = Object.fromEntries(policy.requiredDigests.map((key, index) => [key, hash(String((index % 6) + 1))]));
  const g93Authority = { developSha: 'b'.repeat(40), artifactSha256: '', artifactPath: 'evidence/g93.json', mergeMethodAuthority: { id: 'owner-authority', artifactPath: 'evidence/merge-authority.json', sha256: '' } };
  g93Authority.artifactSha256 = bind(g93Authority.artifactPath, { status: 'VERIFIED', developSha: g93Authority.developSha, releaseBranchAllowed: true }).sha256;
  g93Authority.mergeMethodAuthority.sha256 = bind(g93Authority.mergeMethodAuthority.artifactPath, { id: 'owner-authority', sourceSha, method: 'squash', releaseOnly: true }).sha256;
  const candidate = { id: candidateId, ordinal: 1, status: 'active', sourceSha, treeSha: 'd'.repeat(40), digests, manifestArtifactPath: 'evidence/candidate.json', manifestSha256: '' };
  candidate.manifestSha256 = bind(candidate.manifestArtifactPath, { candidateId, sourceSha, treeSha: candidate.treeSha, digests }).sha256;
  const matrices = policy.requiredMatrices.map((id) => ({ id, ...bind(`evidence/matrix-${id}.json`, { contract: 'voice-room.rc-matrix/v1', id, candidateId, sourceSha, passed: true }) }));
  const reviews = Object.fromEntries(Object.entries(policy.reviewVerdicts).map(([role, verdict]) => [role, bind(`evidence/review-${role}.json`, { contract: 'voice-room.rc-review/v1', role, verdict, sourceSha })]));
  const evidence = { contract: 'voice-room.rc-candidate/v1', release: '2.5.0', version: '2.5.0', branch: 'release/2.5.0', codeSha: sourceSha, baseDevelopSha: g93Authority.developSha, g93Authority, candidates: [candidate], matrices, reviews, productionContacts: 0, productionCredentialReads: 0, productionDeployments: 0, evidenceChainSha256: '' };
  evidence.evidenceChainSha256 = evidenceChainSha256(evidence); bindExternalFixture(evidence);
  return { evidence, expectedSha: sourceSha, resolveArtifact: (path) => artifacts.get(path), resolveTreeSha: () => candidate.treeSha };
}

test('RC-A01 one immutable candidate can reach ready-for-release-PR and no further', () => { const value = fixture(); assert.deepEqual(verifyRcCandidate(policy, value.evidence, value), { status: 'READY_FOR_RELEASE_PR', candidateId: 'rc-1', sourceSha: 'c'.repeat(40) }); });
test('RC-A02 candidate mutation, stale artifacts, missing physical proof and side effects fail closed', () => {
  for (const mutate of [(v) => { v.evidence.g93Authority.developSha = 'a'.repeat(40); }, (v) => { v.evidence.candidates.push(structuredClone(v.evidence.candidates[0])); }, (v) => { v.evidence.candidates[0].digests.api = hash('9'); }, (v) => { v.evidence.matrices = v.evidence.matrices.filter((m) => m.id !== 'physical-desktop'); }, (v) => { v.evidence.matrices[0].sha256 = hash('e'); }, (v) => { v.evidence.reviews.architect.sha256 = hash('a'); }, (v) => { v.evidence.productionContacts = 1; }, (v) => { v.expectedSha = '9'.repeat(40); }, (v) => { v.resolveTreeSha = () => '9'.repeat(40); }]) { const value = fixture(); mutate(value); assert.throws(() => verifyRcCandidate(policy, value.evidence, value)); }
});
test('RC-A05 hostile merge authority for a different source SHA is rejected', () => { const value = fixture(); const ref = value.evidence.g93Authority.mergeMethodAuthority; const bytes = Buffer.from(JSON.stringify({ id: ref.id, sourceSha: '9'.repeat(40), method: 'squash', releaseOnly: true })); ref.sha256 = sha256(bytes); const original = value.resolveArtifact; value.resolveArtifact = (path) => path === ref.artifactPath ? bytes : original(path); assert.throws(() => verifyRcCandidate(policy, value.evidence, value), /stale or hostile/); });
test('RC-A03 invalidated candidate requires a new contiguous fully rebuilt candidate', () => { const value = fixture(); const old = { ...structuredClone(value.evidence.candidates[0]), status: 'invalidated', invalidatedBy: 'rc-2', rebuildRequired: true }; const next = { ...structuredClone(value.evidence.candidates[0]), id: 'rc-2', ordinal: 2, sourceSha: 'e'.repeat(40), treeSha: 'f'.repeat(40) }; value.evidence.candidates = [old, next]; value.expectedSha = next.sourceSha; value.resolveTreeSha = () => next.treeSha; const ref = value.evidence.g93Authority.mergeMethodAuthority; const bytes = Buffer.from(JSON.stringify({ id: ref.id, sourceSha: next.sourceSha, method: 'squash', releaseOnly: true })); ref.sha256 = sha256(bytes); const original = value.resolveArtifact; value.resolveArtifact = (path) => path === ref.artifactPath ? bytes : original(path); assert.throws(() => verifyRcCandidate(policy, value.evidence, value), /candidate manifest/); });
test('RC-A04 current repository cannot assemble an RC while G93 is red', () => { const read = (file) => JSON.parse(fs.readFileSync(file)); assert.throws(() => verifyRepositoryCannotAssemble(read('docs/releases/2.5.0/evidence/index.json'), read('docs/releases/2.5.0/evidence/bootstrap-lineage.json')), /G93 exact SHA authority/); });
