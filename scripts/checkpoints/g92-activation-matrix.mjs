import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  const cases = [{ id: 'all-off', public: [], operators: [] }, { id: 'all-on', public: publicKeys, operators }];
  for (const capability of publicKeys) for (const operator of operators) cases.push({ id: `pair:${capability}:${operator}`, public: [capability], operators: [operator] });
  return { publicKeys, internal, operators, edges: [...new Set(edges)].sort(), cases };
}
export function verifyActivationEvidence(manifestBytes, evidence) {
  const manifest = JSON.parse(manifestBytes); const matrix = buildActivationMatrix(manifest); const digest = manifestDigest(manifestBytes);
  if (evidence?.contract !== 'voice-room.activation-matrix/v1' || evidence.release !== '2.5.0' || !GIT_SHA.test(evidence.gitSha || '') || evidence.manifestSha256 !== digest) throw new Error('G92 immutable identity is invalid');
  const named = new Set(matrix.cases.map((item) => item.id)); const results = new Map((evidence.cases || []).map((item) => [item.id, item]));
  for (const id of named) if (results.get(id)?.passed !== true) throw new Error(`G92 case ${id} missing or failed`);
  for (const id of results.keys()) if (!named.has(id) && !FAILURES.includes(id)) throw new Error(`G92 unnamed case ${id}`);
  for (const failure of FAILURES) { const item = results.get(failure); if (!item?.passed || !item?.failClosed) throw new Error(`G92 failure ${failure} missing or unsafe`); }
  if (!SHA256.test(evidence.evidenceChainSha256 || '')) throw new Error('G92 evidence chain missing');
  return { status: 'VERIFIED', manifestSha256: digest, caseCount: named.size };
}
function cli() {
  const manifestIndex = process.argv.indexOf('--manifest'); const verifyIndex = process.argv.indexOf('--verify');
  if (manifestIndex < 0 || verifyIndex < 0) throw new Error('Usage: --manifest <manifest.json> --verify [evidence.json]');
  const bytes = fs.readFileSync(process.argv[manifestIndex + 1]); const matrix = buildActivationMatrix(JSON.parse(bytes)); const evidenceFile = process.argv[verifyIndex + 1];
  const result = evidenceFile && !evidenceFile.startsWith('--') ? verifyActivationEvidence(bytes, JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))) : { status: 'PENDING_EXTERNAL_ACTIVATION_EVIDENCE', manifestSha256: manifestDigest(bytes), caseCount: matrix.cases.length, edgeCount: matrix.edges.length };
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { cli(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
