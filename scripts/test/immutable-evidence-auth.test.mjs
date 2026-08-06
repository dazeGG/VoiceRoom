import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readExternalArtifact, sha256 } from '../checkpoints/immutable-evidence.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const objectPath = 'checkpoint.json'; const bytes = Buffer.from('{"ok":true}'); const objectDigest = sha256(bytes);
  const expected = { repository:'dazeGG/VoiceRoom',workflowPath:'.github/workflows/evidence-archive.yml',event:'workflow_dispatch',ref:'develop',actor:'dazeGG',headSha:'a'.repeat(40),runAttempt:'2',artifactId:'41',artifactName:'release-250-evidence',archiveSha256:`sha256:${'b'.repeat(64)}`,ociDigest:`sha256:${'c'.repeat(64)}` };
  const run = { id:91,run_attempt:2,path:expected.workflowPath,event:expected.event,head_branch:expected.ref,head_sha:expected.headSha,status:'completed',conclusion:'success',actor:{login:expected.actor},repository:{full_name:expected.repository} };
  const metadata = { id:41,name:expected.artifactName,digest:expected.archiveSha256,expired:false,workflow_run:{id:run.id,head_sha:run.head_sha} };
  const proof = { contract:'voice-room.evidence-oci/v1',repository:expected.repository,workflowPath:expected.workflowPath,event:expected.event,ref:expected.ref,actor:expected.actor,headSha:expected.headSha,runId:run.id,runAttempt:run.run_attempt,conclusion:'success',artifactId:metadata.id,artifactName:metadata.name,artifactArchiveSha256:expected.archiveSha256,ociDigest:expected.ociDigest,attestationVerified:true,archived:true,objectDigests:{[objectPath]:objectDigest} };
  fs.writeFileSync(path.join(root, objectPath), bytes); fs.writeFileSync(path.join(root, 'producer-run.json'), JSON.stringify(run)); fs.writeFileSync(path.join(root, 'producer-metadata.json'), JSON.stringify(metadata)); fs.writeFileSync(path.join(root, 'oci-proof.json'), JSON.stringify(proof));
  return { root, objectPath, objectDigest, expected };
}

test('authenticated evidence accepts only the pinned successful OCI-archived producer', (t) => {
  const value = fixture(t); const result = readExternalArtifact(value.root, value.objectPath, value.objectDigest, value.expected);
  assert.deepEqual(result.value, { ok:true }); assert.equal(result.value._authenticatedProducer.verified, true);
});

test('fabricated same-repository artifact cannot impersonate the authorized producer', (t) => {
  const value = fixture(t); const runPath = path.join(value.root, 'producer-run.json'); const run = JSON.parse(fs.readFileSync(runPath));
  run.path = '.github/workflows/untrusted.yml'; run.actor.login = 'attacker'; fs.writeFileSync(runPath, JSON.stringify(run));
  assert.throws(() => readExternalArtifact(value.root, value.objectPath, value.objectDigest, value.expected), /authorized producer/);
});
