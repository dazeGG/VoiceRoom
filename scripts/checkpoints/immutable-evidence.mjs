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
  Object.defineProperty(value, '_authenticatedProducer', { value: { verified: true, fixture: true } });
  return value;
}
export function bindExternalFixture(value) {
  Object.defineProperty(value, '_externalBinding', { value: { sha256: sha256(Buffer.from(JSON.stringify(value))) } });
  Object.defineProperty(value, '_authenticatedProducer', { value: { verified: true, fixture: true } });
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
  if (value?._authenticatedProducer?.verified !== true) throw new Error('Evidence producer metadata and OCI attestation are not authenticated');
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

function readJson(root, file, label) {
  const target = path.join(root, file);
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`Authenticated evidence ${label} cannot be a symlink`);
  try { return JSON.parse(fs.readFileSync(target)); } catch { throw new Error(`Authenticated evidence ${label} is missing or invalid`); }
}

export function authenticateEvidenceRoot(root, objectPath, objectDigest, expected = {}) {
  const metadata = readJson(root, 'producer-metadata.json', 'artifact metadata');
  const run = readJson(root, 'producer-run.json', 'producer run');
  const proof = readJson(root, 'oci-proof.json', 'OCI proof');
  const archiveDigest = expected.archiveSha256;
  const exact = metadata.id === Number(expected.artifactId) && metadata.name === expected.artifactName && metadata.digest === archiveDigest && metadata.expired === false && metadata.workflow_run?.id === run.id &&
    metadata.workflow_run?.head_sha === run.head_sha && run.repository?.full_name === expected.repository && run.path === expected.workflowPath && run.event === expected.event &&
    run.head_branch === expected.ref && run.actor?.login === expected.actor && run.head_sha === expected.headSha && run.run_attempt === Number(expected.runAttempt) && run.status === 'completed' && run.conclusion === 'success';
  if (!exact) throw new Error('Evidence producer metadata does not match the authorized producer');
  const proofExact = proof.contract === 'voice-room.evidence-oci/v1' && proof.repository === expected.repository && proof.workflowPath === expected.workflowPath &&
    proof.event === expected.event && proof.ref === expected.ref && proof.actor === expected.actor && proof.headSha === expected.headSha && proof.runId === run.id &&
    proof.runAttempt === run.run_attempt && proof.conclusion === 'success' && proof.artifactId === metadata.id && proof.artifactName === metadata.name &&
    proof.artifactArchiveSha256 === archiveDigest && proof.ociDigest === expected.ociDigest && proof.attestationVerified === true && proof.archived === true &&
    proof.objectDigests?.[objectPath] === objectDigest;
  if (!proofExact || !/^sha256:[a-f0-9]{64}$/.test(proof.ociDigest || '')) throw new Error('OCI evidence proof does not bind the authorized Actions artifact and object');
  return Object.freeze({ verified: true, repository: run.repository.full_name, workflowPath: run.path, runId: run.id, runAttempt: run.run_attempt, ociDigest: proof.ociDigest });
}

export function readExternalArtifact(rootDirectory, file, expectedDigest, authentication) {
  if (!rootDirectory || !file || path.isAbsolute(file) || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest || '')) throw new Error('External evidence root, relative object path and SHA256 are required');
  const root = fs.realpathSync(rootDirectory); const requested = path.resolve(root, file); const relative = path.relative(root, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('External evidence path escapes its authenticated root');
  let current = root;
  for (const component of relative.split(path.sep)) { current = path.join(current, component); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('External evidence path contains a symlink'); }
  const resolved = fs.realpathSync(current); const bytes = fs.readFileSync(resolved);
  if (sha256(bytes) !== expectedDigest) throw new Error('External evidence object digest mismatch');
  const value = JSON.parse(bytes);
  const producer = authentication ? authenticateEvidenceRoot(root, file, expectedDigest, authentication) : null;
  Object.defineProperty(value, '_externalBinding', { value: { sha256: expectedDigest } });
  if (producer) Object.defineProperty(value, '_authenticatedProducer', { value: producer });
  Object.defineProperty(value, '_resolveArtifact', { value: (artifactPath) => {
    const artifact = path.resolve(root, artifactPath); const artifactRelative = path.relative(root, artifact);
    if (artifactRelative === '..' || artifactRelative.startsWith(`..${path.sep}`) || path.isAbsolute(artifactRelative)) throw new Error('External proof path escapes its authenticated root');
    let cursor = root; for (const component of artifactRelative.split(path.sep)) { cursor = path.join(cursor, component); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('External proof path contains a symlink'); }
    return fs.readFileSync(fs.realpathSync(cursor));
  } });
  return { bytes, value };
}

export function externalAuthenticationFromCli(argv = process.argv) {
  const arg = (name, envName) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : process.env[envName]; };
  const authentication = { repository:arg('--producer-repository','EVIDENCE_PRODUCER_REPOSITORY'),workflowPath:arg('--producer-workflow','EVIDENCE_PRODUCER_WORKFLOW'),event:arg('--producer-event','EVIDENCE_PRODUCER_EVENT'),ref:arg('--producer-ref','EVIDENCE_PRODUCER_REF'),actor:arg('--producer-actor','EVIDENCE_PRODUCER_ACTOR'),headSha:arg('--producer-head-sha','EVIDENCE_PRODUCER_HEAD_SHA'),runAttempt:arg('--producer-run-attempt','EVIDENCE_PRODUCER_RUN_ATTEMPT'),artifactId:arg('--artifact-id','EVIDENCE_ARTIFACT_ID'),artifactName:arg('--artifact-name','EVIDENCE_ARTIFACT_NAME'),archiveSha256:arg('--archive-sha256','EVIDENCE_ARCHIVE_SHA256'),ociDigest:arg('--oci-digest','EVIDENCE_OCI_DIGEST') };
  if (Object.values(authentication).some((value) => !value)) throw new Error('Authenticated producer and pinned OCI arguments are required');
  return authentication;
}

export function readExternalCliArtifact(argv = process.argv) {
  const verify = argv.indexOf('--verify'); const root = argv.indexOf('--external-root'); const digest = argv.indexOf('--sha256');
  if (verify < 0 || !argv[verify + 1] || root < 0 || !argv[root + 1] || digest < 0 || !argv[digest + 1]) throw new Error('Usage requires --external-root DIR --verify OBJECT --sha256 SHA256');
  const authentication = externalAuthenticationFromCli(argv);
  return readExternalArtifact(argv[root + 1], argv[verify + 1], argv[digest + 1], authentication);
}
