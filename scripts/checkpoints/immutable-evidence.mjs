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
  Object.defineProperty(value, '_externalBinding', { value: { sha256: sha256(Buffer.from(JSON.stringify(value))) } });
  return value;
}
export function bindExternalFixture(value) {
  Object.defineProperty(value, '_externalBinding', { value: { sha256: sha256(Buffer.from(JSON.stringify(value))) } });
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
  if (!value?._externalBinding || !/^sha256:[a-f0-9]{64}$/.test(value._externalBinding.sha256 || '')) throw new Error('Evidence must come from an externally digest-bound artifact');
  if (expectedSha && value.codeSha !== expectedSha) throw new Error('Evidence code SHA does not match the evaluated workflow HEAD');
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

export function readExternalArtifact(rootDirectory, file, expectedDigest) {
  if (!rootDirectory || !file || path.isAbsolute(file) || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest || '')) throw new Error('External evidence root, relative object path and SHA256 are required');
  const root = fs.realpathSync(rootDirectory); const requested = path.resolve(root, file); const relative = path.relative(root, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('External evidence path escapes its authenticated root');
  let current = root;
  for (const component of relative.split(path.sep)) { current = path.join(current, component); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('External evidence path contains a symlink'); }
  const resolved = fs.realpathSync(current); const bytes = fs.readFileSync(resolved);
  if (sha256(bytes) !== expectedDigest) throw new Error('External evidence object digest mismatch');
  const value = JSON.parse(bytes);
  Object.defineProperty(value, '_externalBinding', { value: { sha256: expectedDigest } });
  Object.defineProperty(value, '_resolveArtifact', { value: (artifactPath) => {
    const artifact = path.resolve(root, artifactPath); const artifactRelative = path.relative(root, artifact);
    if (artifactRelative === '..' || artifactRelative.startsWith(`..${path.sep}`) || path.isAbsolute(artifactRelative)) throw new Error('External proof path escapes its authenticated root');
    let cursor = root; for (const component of artifactRelative.split(path.sep)) { cursor = path.join(cursor, component); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('External proof path contains a symlink'); }
    return fs.readFileSync(fs.realpathSync(cursor));
  } });
  return { bytes, value };
}

export function readExternalCliArtifact(argv = process.argv) {
  const verify = argv.indexOf('--verify'); const root = argv.indexOf('--external-root'); const digest = argv.indexOf('--sha256');
  if (verify < 0 || !argv[verify + 1] || root < 0 || !argv[root + 1] || digest < 0 || !argv[digest + 1]) throw new Error('Usage requires --external-root DIR --verify OBJECT --sha256 SHA256');
  return readExternalArtifact(argv[root + 1], argv[verify + 1], argv[digest + 1]);
}
