import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertCheckpointArtifact, assertEvidenceIdentity, readExternalCliArtifact, readRepositoryArtifact } from './immutable-evidence.mjs';

const EXPECTED = { public: 9, internal: 10, operators: 15 };
const SHA256 = /^sha256:[a-f0-9]{64}$/; const GIT_SHA = /^[a-f0-9]{40}$/;
const FAILURES = ['provider-failure', 'worker-failure', 'livekit-failure', 'disk-failure', 'restart', 'stale-replica'];
export function manifestDigest(bytes) { return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`; }
function unique(items, label) { if (new Set(items).size !== items.length) throw new Error(`Duplicate ${label}`); return new Set(items); }
export function buildActivationMatrix(manifest) {
  if (manifest?.contract !== 'voice-room.capabilities/v1' || manifest.schemaVersion !== 1) throw new Error('Invalid G92 manifest');
  const publicKeys = (manifest.publicKeys || []).map((item) => item.key); const internal = (manifest.internalPrerequisites || []).map((item) => item.key); const operators = (manifest.operatorFlags || []).map((item) => item.key);
  const publicSet = unique(publicKeys, 'public key'); unique(internal, 'internal prerequisite'); unique(operators, 'operator');
  if (publicKeys.length !== EXPECTED.public || internal.length !== EXPECTED.internal || operators.length !== EXPECTED.operators) throw new Error('G92 manifest cardinality changed');
  const edges = [];
  for (const node of manifest.publicKeys) {
    for (const dependency of node.dependsOn || []) { if (!publicSet.has(dependency)) throw new Error(`Unknown DAG dependency ${dependency}`); edges.push(`${dependency}->${node.key}`); }
    for (const dependency of node.requires?.internal || []) { if (!internal.includes(dependency)) throw new Error(`Unknown internal prerequisite ${dependency}`); edges.push(`${dependency}->${node.key}`); }
  }
  for (const node of manifest.internalPrerequisites) for (const consumer of node.requiredBy || []) if (!publicSet.has(consumer)) throw new Error(`Unknown internal consumer ${consumer}`);
  for (const flag of manifest.operatorFlags) for (const consumer of flag.requiredBy || []) if (!publicSet.has(consumer)) throw new Error(`Unknown operator consumer ${consumer}`);
  const cases = [{ id: 'all-off', public: [], internal: [], operators: [] }, { id: 'all-on', public: publicKeys, internal, operators }];
  for (const capability of publicKeys) for (const operator of operators) cases.push({ id: `pair:${capability}:${operator}`, public: [capability], operators: [operator] });
  for (const prerequisite of internal) cases.push({ id: `internal:${prerequisite}`, public: [], internal: [prerequisite], operators: [] });
  for (const edge of [...new Set(edges)].sort()) {
    const [dependency, consumer] = edge.split('->');
    cases.push({ id: `edge:${edge}`, public: [consumer], internal: [], operators: [], omittedPrerequisite: dependency, expectedEnabled: false });
  }
  return { publicKeys, internal, operators, edges: [...new Set(edges)].sort(), cases };
}
export function verifyActivationEvidence(manifestBytes, evidence, { expectedSha, resolveArtifact } = {}) {
  const manifest = JSON.parse(manifestBytes); const matrix = buildActivationMatrix(manifest); const digest = manifestDigest(manifestBytes);
  if (evidence?.contract !== 'voice-room.activation-matrix/v1' || evidence.release !== '2.5.0' || !GIT_SHA.test(evidence.codeSha || '') || evidence.manifestSha256 !== digest) throw new Error('G92 immutable identity is invalid');
  const named = new Set(matrix.cases.map((item) => item.id)); const results = new Map((evidence.cases || []).map((item) => [item.id, item]));
  for (const expected of matrix.cases) {
    const actual = results.get(expected.id);
    if (actual?.passed !== true) throw new Error(`G92 case ${expected.id} missing or failed`);
    for (const field of ['public', 'internal', 'operators']) exactVector(actual[field] || [], expected[field] || [], `${expected.id}.${field}`);
    if (expected.expectedEnabled === false && actual.enabled !== false) throw new Error(`G92 edge ${expected.id} did not fail closed`);
  }
  for (const id of results.keys()) if (!named.has(id) && !FAILURES.includes(id)) throw new Error(`G92 unnamed case ${id}`);
  for (const failure of FAILURES) { const item = results.get(failure); if (!item?.passed || !item?.failClosed || item.vector !== failure) throw new Error(`G92 failure ${failure} missing, stale or unsafe`); }
  if (!SHA256.test(evidence.evidenceChainSha256 || '')) throw new Error('G92 evidence chain missing');
  assertCheckpointArtifact(evidence, resolveArtifact);
  assertEvidenceIdentity(evidence, expectedSha);
  return { status: 'VERIFIED', manifestSha256: digest, caseCount: named.size };
}
function exactVector(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || [...actual].sort().some((item, index) => item !== [...expected].sort()[index])) throw new Error(`G92 vector ${label} is stale`);
}
function cli() {
  const manifestIndex = process.argv.indexOf('--manifest'); const verifyIndex = process.argv.indexOf('--verify');
  if (manifestIndex < 0 || verifyIndex < 0) throw new Error('Usage: --manifest <manifest.json> --verify [evidence.json]');
  const bytes = readRepositoryArtifact(process.argv[manifestIndex + 1]).bytes; const matrix = buildActivationMatrix(JSON.parse(bytes)); const evidenceFile = process.argv[verifyIndex + 1];
  const result = evidenceFile && !evidenceFile.startsWith('--') ? verifyActivationEvidence(bytes, readExternalCliArtifact(process.argv).value, { expectedSha: process.env.GITHUB_SHA }) : { status: 'PENDING_EXTERNAL_ACTIVATION_EVIDENCE', manifestSha256: manifestDigest(bytes), caseCount: matrix.cases.length, edgeCount: matrix.edges.length };
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
