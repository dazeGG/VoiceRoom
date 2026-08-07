import assert from 'node:assert/strict'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process'; import test from 'node:test'; import { pathToFileURL } from 'node:url';
import { assertEvidenceIdentity, bindExternalFixture, evidenceChainSha256, externalAuthenticationFromCli, readExternalArtifact } from '../checkpoints/immutable-evidence.mjs';
const SHA256 = /^sha256:[a-f0-9]{64}$/; const GIT_SHA = /^[a-f0-9]{40}$/;
export function verifyEntryGate({ index, lineage, selection, envelope, repairLedger, archiveMap, archiveLedger, expectedSha, isAncestor = () => true }) {
  if (lineage?.schemaVersion !== 1 || lineage.release !== '2.5.0' || !lineage.selectedAttemptId || !GIT_SHA.test(lineage.terminalDevelopSha || '') || !Array.isArray(lineage.ancestors)) throw new Error('G93 terminal bootstrap lineage is unavailable');
  if (selection?.attempt_id !== lineage.selectedAttemptId || selection?.terminal_develop_sha !== lineage.terminalDevelopSha || selection?.status !== 'selected') throw new Error('G93 external selection mismatch');
  if (selection?._artifactSha256 !== lineage.sourceDigests?.selection) throw new Error('G93 selection artifact digest mismatch');
  if (expectedSha && !isAncestor(lineage.terminalDevelopSha, expectedSha)) throw new Error('G93 bootstrap SHA is not an ancestor of workflow HEAD');
  if (envelope?.contract !== 'voice-room.g93-envelope/v1' || envelope.bootstrapSha !== lineage.terminalDevelopSha || envelope.selectionSha256 !== selection._artifactSha256) throw new Error('G93 external envelope does not bind bootstrap authority');
  assertEvidenceIdentity(envelope, expectedSha);
  if (!SHA256.test(lineage.sourceDigests?.selection || '') || !SHA256.test(lineage.sourceDigests?.attempts || '') || !SHA256.test(lineage.sourceDigests?.recoveries || '')) throw new Error('G93 lineage source digests missing');
  if (index?.status === 'G03_PRE_PUBLICATION' || !Array.isArray(archiveMap?.objects) || archiveMap.objects.length === 0 || !Array.isArray(archiveLedger?.entries) || archiveLedger.entries.length === 0) throw new Error('G93 archive chain is not current');
  for (const key of ['g42MessagingCheckpoint','g50MembershipCheckpoint','g71EngagementCheckpoint','g90MediaCheckpoint','g91ReleaseBudgets','g92ActivationMatrix']) if (index?.[key]?.status !== 'VERIFIED') throw new Error(`G93 prerequisite ${key} is pending`);
  const entries = repairLedger?.entries || []; const phases = new Map();
  for (const entry of entries) {
    if (!/^R-G(?:0[2-9]|[1-8][0-9]|9[0-3])-\d{2}$/.test(entry.id || '')) throw new Error('G93 invalid or bootstrap repair id');
    const current = phases.get(entry.id) || []; current.push(entry.phase); phases.set(entry.id, current);
  }
  for (const [id, value] of phases) if (value.join(',') !== 'authorization,fix') throw new Error(`G93 repair ${id} phases are incomplete or reordered`);
  return { status: 'RELEASE_BRANCH_AUTHORIZED', branch: 'release/2.5.0', terminalDevelopSha: lineage.terminalDevelopSha };
}
function synthetic() {
  const digest = `sha256:${'a'.repeat(64)}`; const checkpoints = Object.fromEntries(['g42MessagingCheckpoint','g50MembershipCheckpoint','g71EngagementCheckpoint','g90MediaCheckpoint','g91ReleaseBudgets','g92ActivationMatrix'].map((key) => [key, { status: 'VERIFIED' }]));
  const value = { index: { status: 'G03_ARCHIVED', ...checkpoints }, lineage: { schemaVersion: 1, release: '2.5.0', selectedAttemptId: 'attempt-1', terminalDevelopSha: 'b'.repeat(40), ancestors: [], sourceDigests: { selection: digest, attempts: digest, recoveries: digest } }, selection: { attempt_id: 'attempt-1', terminal_develop_sha: 'b'.repeat(40), status: 'selected', _artifactSha256: digest }, envelope: { contract: 'voice-room.g93-envelope/v1', codeSha: 'c'.repeat(40), bootstrapSha: 'b'.repeat(40), selectionSha256: digest, evidenceChainSha256: '' }, repairLedger: { entries: [] }, archiveMap: { objects: [{}] }, archiveLedger: { entries: [{}] } };
  value.envelope.evidenceChainSha256 = evidenceChainSha256(value.envelope); bindExternalFixture(value.envelope); return value;
}
if (!process.argv.includes('--gate')) {
  test('G93-A01 one external envelope authorizes when bootstrap is an ancestor of its exact code SHA', () => { const value = synthetic(); assert.deepEqual(verifyEntryGate({ ...value, expectedSha: 'c'.repeat(40), isAncestor: (base, head) => base === 'b'.repeat(40) && head === 'c'.repeat(40) }), { status: 'RELEASE_BRANCH_AUTHORIZED', branch: 'release/2.5.0', terminalDevelopSha: 'b'.repeat(40) }); });
  test('G93-A02 pending archive/checkpoints and malformed repair chains fail closed', () => {
    for (const mutate of [(v) => { v.index.g90MediaCheckpoint.status = 'PENDING_EXTERNAL_STAGING'; }, (v) => { v.lineage.sourceDigests.selection = 'mutable'; }, (v) => { v.selection.attempt_id = 'other'; }, (v) => { v.repairLedger.entries = [{ id: 'R-G90-01', phase: 'fix' }]; }, (v) => { v.repairLedger.entries = [{ id: 'R-G01-01', phase: 'authorization' }, { id: 'R-G01-01', phase: 'fix' }]; }]) { const value = synthetic(); mutate(value); assert.throws(() => verifyEntryGate(value)); }
  });
  test('G93-A03 copied/self-declared envelopes and non-ancestor bootstrap SHAs fail closed', () => { const copied = synthetic(); copied.envelope = JSON.parse(JSON.stringify(copied.envelope)); assert.throws(() => verifyEntryGate(copied), /externally digest-bound/); const ancestry = synthetic(); assert.throws(() => verifyEntryGate({ ...ancestry, expectedSha: 'c'.repeat(40), isAncestor: () => false }), /not an ancestor/); });
  test('G93 repository state remains pending and cannot authorize release entry', () => {
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')); assert.throws(() => verifyEntryGate({ index: read('docs/releases/2.5.0/evidence/index.json'), lineage: read('docs/releases/2.5.0/evidence/bootstrap-lineage.json'), selection: null, repairLedger: read('docs/releases/2.5.0/evidence/repair-ledger.json'), archiveMap: read('docs/releases/2.5.0/evidence/archive-map.json'), archiveLedger: read('docs/releases/2.5.0/evidence/archive-ledger.json') }));
  });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const arg = (name) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`G93 ${name} is required`); return process.argv[index + 1]; };
    const root = arg('--external-root'); const authentication = externalAuthenticationFromCli(process.argv); const selectionArtifact = readExternalArtifact(root, arg('--selection'), arg('--selection-sha256'), authentication); const envelopeArtifact = readExternalArtifact(root, arg('--envelope'), arg('--envelope-sha256'), authentication);
    const selection = { ...selectionArtifact.value, _artifactSha256: arg('--selection-sha256') };
    verifyEntryGate({ index: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json')), lineage: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/bootstrap-lineage.json')), selection, envelope: envelopeArtifact.value, repairLedger: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/repair-ledger.json')), archiveMap: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/archive-map.json')), archiveLedger: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/archive-ledger.json')), expectedSha: process.env.GITHUB_SHA, isAncestor: (base, head) => spawnSync('git', ['merge-base', '--is-ancestor', base, head]).status === 0 });
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
