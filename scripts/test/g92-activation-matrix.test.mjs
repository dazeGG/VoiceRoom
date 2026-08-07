import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test';
import { buildActivationMatrix, manifestDigest, verifyActivationEvidence } from '../checkpoints/g92-activation-matrix.mjs';
import { bindCheckpointFixture, evidenceChainSha256 } from '../checkpoints/immutable-evidence.mjs';
const bytes = fs.readFileSync('config/capability-dag.v1.json'); const manifest = JSON.parse(bytes); const hash = (character) => `sha256:${character.repeat(64)}`;
test('G92-A01 generated matrix covers exact manifest nodes, operators and edges', () => {
  const matrix = buildActivationMatrix(manifest); assert.equal(matrix.publicKeys.length, 9); assert.equal(matrix.internal.length, 10); assert.equal(matrix.operators.length, 15);
  assert.equal(matrix.cases.length, 137 + matrix.internal.length + matrix.edges.length); assert.ok(matrix.edges.length > 0);
  for (const key of matrix.publicKeys) assert.ok(matrix.cases.some((item) => item.public.includes(key)));
  for (const key of matrix.internal) assert.ok(matrix.cases.some((item) => item.id === `internal:${key}` && item.internal.includes(key)));
  for (const key of matrix.operators) assert.ok(matrix.cases.some((item) => item.operators.includes(key)));
  for (const edge of matrix.edges) assert.ok(matrix.cases.some((item) => item.id === `edge:${edge}` && item.enabled !== true));
});
test('G92-A02 evidence rejects unknown, stale, mutable or unsafe matrices', () => {
  const matrix = buildActivationMatrix(manifest); const evidence = { contract: 'voice-room.activation-matrix/v1', release: '2.5.0', codeSha: 'a'.repeat(40), manifestSha256: manifestDigest(bytes), cases: [...matrix.cases.map((item) => ({ ...item, enabled: item.expectedEnabled ?? true, passed: true })), ...['provider-failure','worker-failure','livekit-failure','disk-failure','restart','stale-replica'].map((id) => ({ id, vector: id, passed: true, failClosed: true }))], evidenceChainSha256: '' };
  bindCheckpointFixture(evidence, 'evidence/g92-proof.json'); evidence.evidenceChainSha256 = evidenceChainSha256(evidence);
  assert.equal(verifyActivationEvidence(bytes, evidence).status, 'VERIFIED');
  for (const mutate of [(value) => { value.manifestSha256 = hash('e'); }, (value) => { value.cases.pop(); }, (value) => { value.cases.push({ id: 'unknown-flag', passed: true }); }, (value) => { value.cases.at(-1).failClosed = false; }, (value) => { value.cases.find((item) => item.id.startsWith('internal:')).internal = []; }, (value) => { value.cases.find((item) => item.id.startsWith('edge:')).enabled = true; }, (value) => { value.cases.find((item) => item.id === 'stale-replica').vector = 'restart'; }]) { const copy = structuredClone(evidence); mutate(copy); assert.throws(() => verifyActivationEvidence(bytes, copy)); }
});
