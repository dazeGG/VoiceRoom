import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(bytes) { return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== 'evidenceChainSha256').map((key) => [key, canonical(value[key])]));
  return value;
}
export function evidenceChainSha256(value) { return sha256(Buffer.from(JSON.stringify(canonical(value)))); }
function checkpointPayload(value) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'evidenceChainSha256' && key !== 'proofBundle')); }
export function bindCheckpointFixture(value, artifactPath = 'evidence/checkpoint-proof.json') {
  const bytes = Buffer.from(JSON.stringify(checkpointPayload(value)));
  value.proofBundle = { artifactPath, sha256: sha256(bytes) };
  Object.defineProperty(value, '_resolveArtifact', { value: () => bytes });
  return value;
}
export function assertCheckpointArtifact(value, resolveArtifact = value?._resolveArtifact || ((file) => readRepositoryArtifact(file).bytes)) {
  const reference = value?.proofBundle;
  if (!reference?.artifactPath || !/^sha256:[a-f0-9]{64}$/.test(reference.sha256 || '')) throw new Error('Checkpoint proof artifact reference is missing');
  const bytes = resolveArtifact(reference.artifactPath);
  if (sha256(bytes) !== reference.sha256) throw new Error('Checkpoint proof artifact digest mismatch');
  let artifact; try { artifact = JSON.parse(bytes); } catch { throw new Error('Checkpoint proof artifact is not JSON'); }
  if (JSON.stringify(canonical(artifact)) !== JSON.stringify(canonical(checkpointPayload(value)))) throw new Error('Checkpoint proof artifact does not bind the verified evidence');
}
export function assertEvidenceIdentity(value, expectedSha) {
  if (expectedSha && value.gitSha !== expectedSha) throw new Error('Evidence git SHA does not match the exact workflow HEAD');
  if (value.evidenceChainSha256 !== evidenceChainSha256(value)) throw new Error('Evidence checksum chain does not match its contents');
}
export function readRepositoryArtifact(file) {
  if (!file || path.isAbsolute(file)) throw new Error('Evidence path must be repository-relative');
  const root = fs.realpathSync(process.cwd()); const requested = path.resolve(file); const relative = path.relative(root, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Evidence path must be repository-relative');
  let current = root;
  for (const component of relative.split(path.sep)) { current = path.join(current, component); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Evidence path contains a symlink'); }
  const resolved = fs.realpathSync(current); const bytes = fs.readFileSync(resolved); return { bytes, value: JSON.parse(bytes) };
}
