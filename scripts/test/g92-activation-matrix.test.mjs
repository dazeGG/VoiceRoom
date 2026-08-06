import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test';
import { buildActivationMatrix, manifestDigest, verifyActivationEvidence } from '../checkpoints/g92-activation-matrix.mjs';
const bytes = fs.readFileSync('config/capability-dag.v1.json'); const manifest = JSON.parse(bytes); const hash = (character) => `sha256:${character.repeat(64)}`;
test('G92-A01 generated matrix covers exact manifest nodes, operators and edges', () => {
  const matrix = buildActivationMatrix(manifest); assert.equal(matrix.publicKeys.length, 9); assert.equal(matrix.internal.length, 10); assert.equal(matrix.operators.length, 15);
  assert.equal(matrix.cases.length, 137); assert.ok(matrix.edges.length > 0);
  for (const key of matrix.publicKeys) assert.ok(matrix.cases.some((item) => item.public.includes(key)));
  for (const key of matrix.operators) assert.ok(matrix.cases.some((item) => item.operators.includes(key)));
});
test('G92-A02 evidence rejects unknown, stale, mutable or unsafe matrices', () => {
  const matrix = buildActivationMatrix(manifest); const evidence = { contract: 'voice-room.activation-matrix/v1', release: '2.5.0', gitSha: 'a'.repeat(40), manifestSha256: manifestDigest(bytes), cases: [...matrix.cases.map(({ id }) => ({ id, passed: true })), ...['provider-failure','worker-failure','livekit-failure','disk-failure','restart','stale-replica'].map((id) => ({ id, passed: true, failClosed: true }))], evidenceChainSha256: hash('f') };
  assert.equal(verifyActivationEvidence(bytes, evidence).status, 'VERIFIED');
  for (const mutate of [(value) => { value.manifestSha256 = hash('e'); }, (value) => { value.cases.pop(); }, (value) => { value.cases.push({ id: 'unknown-flag', passed: true }); }, (value) => { value.cases.at(-1).failClosed = false; }]) { const copy = structuredClone(evidence); mutate(copy); assert.throws(() => verifyActivationEvidence(bytes, copy)); }
});
