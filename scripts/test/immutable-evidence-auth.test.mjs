import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readExternalArtifact, sha256 } from '../checkpoints/immutable-evidence.mjs';

function storedZip(entries) {
  const locals=[];const centrals=[];let offset=0;
  for(const entry of entries){const name=Buffer.from(entry.name);const bytes=Buffer.from(entry.bytes||'');const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);locals.push(local,name,bytes);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE((3<<8)|20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(((entry.mode??0o100644)<<16)>>>0,38);central.writeUInt32LE(offset,42);centrals.push(central,name);offset+=local.length+name.length+bytes.length;}
  const directory=Buffer.concat(centrals);const eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50);eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);eocd.writeUInt32LE(directory.length,12);eocd.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,eocd]);
}

function fixture(t,{archiveEntries,ociBytes=Buffer.from('{"ok":true}')}={}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const objectPath = 'checkpoint.json'; const objectDigest = sha256(ociBytes);const archive=storedZip(archiveEntries||[{name:objectPath,bytes:ociBytes}]);
  const expected = { repository:'dazeGG/VoiceRoom',workflowPath:'.github/workflows/evidence-archive.yml',event:'workflow_dispatch',ref:'develop',actor:'dazeGG',headSha:'a'.repeat(40),runAttempt:'2',artifactId:'41',artifactName:'release-250-evidence',archiveSha256:sha256(archive),ociDigest:`sha256:${'c'.repeat(64)}` };
  const run = { id:91,run_attempt:2,path:expected.workflowPath,event:expected.event,head_branch:expected.ref,head_sha:expected.headSha,status:'completed',conclusion:'success',actor:{login:expected.actor},repository:{full_name:expected.repository} };
  const metadata = { id:41,name:expected.artifactName,digest:expected.archiveSha256,expired:false,workflow_run:{id:run.id,head_sha:run.head_sha} };
  const proof = { contract:'voice-room.evidence-oci/v1',repository:expected.repository,workflowPath:expected.workflowPath,event:expected.event,ref:expected.ref,actor:expected.actor,headSha:expected.headSha,runId:run.id,runAttempt:run.run_attempt,conclusion:'success',artifactId:metadata.id,artifactName:metadata.name,artifactArchiveSha256:expected.archiveSha256,ociDigest:expected.ociDigest,attestationVerified:true,archived:true,objectDigests:{[objectPath]:objectDigest} };
  fs.writeFileSync(path.join(root, objectPath), ociBytes);fs.writeFileSync(path.join(root,'actions-archive.zip'),archive);fs.writeFileSync(path.join(root, 'producer-run.json'), JSON.stringify(run)); fs.writeFileSync(path.join(root, 'producer-metadata.json'), JSON.stringify(metadata)); fs.writeFileSync(path.join(root, 'oci-proof.json'), JSON.stringify(proof));
  return { root, objectPath, objectDigest, expected,archive };
}

test('authenticated evidence accepts only the pinned successful OCI-archived producer', (t) => {
  const value = fixture(t);fs.rmSync(path.join(value.root,'oci-proof.json'));const result = readExternalArtifact(value.root, value.objectPath, value.objectDigest, value.expected);
  assert.deepEqual(result.value, { ok:true }); assert.equal(result.value._authenticatedProducer.verified, true);
});

test('fabricated same-repository artifact cannot impersonate the authorized producer', (t) => {
  const value = fixture(t); const runPath = path.join(value.root, 'producer-run.json'); const run = JSON.parse(fs.readFileSync(runPath));
  run.path = '.github/workflows/untrusted.yml'; run.actor.login = 'attacker'; fs.writeFileSync(runPath, JSON.stringify(run));
  assert.throws(() => readExternalArtifact(value.root, value.objectPath, value.objectDigest, value.expected), /authorized producer/);
});

test('same-repository attested OCI self-declaration cannot link different archive bytes', (t) => {
  const value=fixture(t,{archiveEntries:[{name:'checkpoint.json',bytes:'{"archive":true}'}],ociBytes:Buffer.from('{"oci":true}')});
  assert.throws(()=>readExternalArtifact(value.root,value.objectPath,value.objectDigest,value.expected),/archive and OCI evidence object do not match/);
});

test('tampered archive, escaping path and symlink entries fail closed', (t) => {
  const tampered=fixture(t);const bytes=Buffer.from(tampered.archive);bytes[35]^=1;fs.writeFileSync(path.join(tampered.root,'actions-archive.zip'),bytes);
  assert.throws(()=>readExternalArtifact(tampered.root,tampered.objectPath,tampered.objectDigest,tampered.expected),/archive digest mismatch/);
  const escaped=fixture(t,{archiveEntries:[{name:'checkpoint.json',bytes:'{"ok":true}'},{name:'../escape.json',bytes:'x'}]});
  assert.throws(()=>readExternalArtifact(escaped.root,escaped.objectPath,escaped.objectDigest,escaped.expected),/canonical repository-relative/);
  const linked=fixture(t,{archiveEntries:[{name:'checkpoint.json',bytes:'{"ok":true}'},{name:'link',bytes:'checkpoint.json',mode:0o120777}]});
  assert.throws(()=>readExternalArtifact(linked.root,linked.objectPath,linked.objectDigest,linked.expected),/contains a symlink/);
});

test('every release consumer retains the checksummed Actions archive beside the exact OCI pull', () => {
  for(const workflow of ['checkpoint.yml','release-performance.yml','release-entry.yml','release-candidate-preflight.yml']){
    const source=fs.readFileSync(path.join(process.cwd(),'.github','workflows',workflow),'utf8');
    assert.match(source,/test "sha256:\$\(sha256sum external-evidence\.zip/);
    assert.match(source,/oras pull "\$OCI_REPOSITORY@\$OCI_DIGEST" -o external-evidence/);
    assert.match(source,/mv external-evidence\.zip external-evidence\/actions-archive\.zip/);
  }
});
