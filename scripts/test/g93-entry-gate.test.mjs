import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test'; import { pathToFileURL } from 'node:url';
const SHA256 = /^sha256:[a-f0-9]{64}$/; const GIT_SHA = /^[a-f0-9]{40}$/;
export function verifyEntryGate({ index, lineage, selection, repairLedger, archiveMap, archiveLedger }) {
  if (lineage?.schemaVersion !== 1 || lineage.release !== '2.5.0' || !lineage.selectedAttemptId || !GIT_SHA.test(lineage.terminalDevelopSha || '') || !Array.isArray(lineage.ancestors)) throw new Error('G93 terminal bootstrap lineage is unavailable');
  if (selection?.attempt_id !== lineage.selectedAttemptId || selection?.terminal_develop_sha !== lineage.terminalDevelopSha || selection?.status !== 'selected') throw new Error('G93 external selection mismatch');
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
  return { index: { status: 'G03_ARCHIVED', ...checkpoints }, lineage: { schemaVersion: 1, release: '2.5.0', selectedAttemptId: 'attempt-1', terminalDevelopSha: 'b'.repeat(40), ancestors: [], sourceDigests: { selection: digest, attempts: digest, recoveries: digest } }, selection: { attempt_id: 'attempt-1', terminal_develop_sha: 'b'.repeat(40), status: 'selected' }, repairLedger: { entries: [] }, archiveMap: { objects: [{}] }, archiveLedger: { entries: [{}] } };
}
if (!process.argv.includes('--gate')) {
  test('G93-A01 one immutable external lineage can authorize only the release branch', () => { assert.deepEqual(verifyEntryGate(synthetic()), { status: 'RELEASE_BRANCH_AUTHORIZED', branch: 'release/2.5.0', terminalDevelopSha: 'b'.repeat(40) }); });
  test('G93-A02 pending archive/checkpoints and malformed repair chains fail closed', () => {
    for (const mutate of [(v) => { v.index.g90MediaCheckpoint.status = 'PENDING_EXTERNAL_STAGING'; }, (v) => { v.lineage.sourceDigests.selection = 'mutable'; }, (v) => { v.selection.attempt_id = 'other'; }, (v) => { v.repairLedger.entries = [{ id: 'R-G90-01', phase: 'fix' }]; }, (v) => { v.repairLedger.entries = [{ id: 'R-G01-01', phase: 'authorization' }, { id: 'R-G01-01', phase: 'fix' }]; }]) { const value = structuredClone(synthetic()); mutate(value); assert.throws(() => verifyEntryGate(value)); }
  });
  test('G93 repository state remains pending and cannot authorize release entry', () => {
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')); assert.throws(() => verifyEntryGate({ index: read('docs/releases/2.5.0/evidence/index.json'), lineage: read('docs/releases/2.5.0/evidence/bootstrap-lineage.json'), selection: null, repairLedger: read('docs/releases/2.5.0/evidence/repair-ledger.json'), archiveMap: read('docs/releases/2.5.0/evidence/archive-map.json'), archiveLedger: read('docs/releases/2.5.0/evidence/archive-ledger.json') }));
  });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { verifyEntryGate({ index: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/index.json')), lineage: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/bootstrap-lineage.json')), selection: null, repairLedger: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/repair-ledger.json')), archiveMap: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/archive-map.json')), archiveLedger: JSON.parse(fs.readFileSync('docs/releases/2.5.0/evidence/archive-ledger.json')) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
