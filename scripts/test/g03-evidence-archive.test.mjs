import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ARCHIVE_ARTIFACT_TYPE,
  EMPTY_CONFIG_DIGEST,
  PUBLICATION_SEQUENCE,
  ARCHIVE_OBJECT_ORDER,
  aggregateArchiveProofs,
  appendArchiveProof,
  buildArchiveObject,
  classifyPublicationFailure,
  sha256,
  validateArchiveSourceSet,
} from "../evidence/archive-to-oci.mjs";
import { verifyRecoveredObject } from "../evidence/recover-from-oci.mjs";
import { checkArchiveSentinel, deriveLiveObservation } from "../evidence/check-archive-sentinel.mjs";

const SHA = (character) => character.repeat(40);
const bytes = Buffer.from('{"goal":"G02","phase":"F11"}');

function prepared(overrides = {}) {
  return buildArchiveObject({
    objectId: "merge-envelope.g02.json",
    sourcePath: "g02/f11.zip",
    sourceSha: SHA("a"),
    runId: 29689533434,
    runAttempt: 1,
    sourceArtifactId: 8443130578,
    bytes,
    ...overrides,
  });
}

test("G03-A01 builds a standalone digest-authoritative object from exact source bytes", () => {
  const object = prepared();
  assert.equal(object.layer.digest, sha256(bytes));
  assert.equal(object.layer.size, bytes.length);
  assert.equal(object.layer.mediaType, "application/json");
  assert.equal(object.config.digest, EMPTY_CONFIG_DIGEST);
  assert.equal(object.config.size, 2);
  assert.equal(object.manifest.artifactType, ARCHIVE_ARTIFACT_TYPE);
  assert.equal(object.manifest.layers.length, 1);
  assert.equal(Object.hasOwn(object.manifest, "subject"), false);
  assert.equal(object.reference, `ghcr.io/dazegg/voiceroom-release-evidence@${object.manifestDigest}`);
  assert.match(object.discoveryTag, /^evidence-merge-envelope-g02-json-[0-9a-f]{12}-run29689533434-attempt1$/);
  assert.deepEqual(Object.keys(object.manifest.annotations).sort(), [
    "io.voiceroom.evidence.id",
    "io.voiceroom.github.run-attempt",
    "io.voiceroom.github.run-id",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.source",
  ]);
});

test("G03-A01 preserves compact bytes and rejects mutable or ambiguous authority", () => {
  assert.equal(prepared({ bytes: Buffer.from(`${bytes}\n`) }).layer.digest, sha256(Buffer.from(`${bytes}\n`)));
  assert.throws(() => prepared({ bytes: Buffer.from(`${bytes}\n\n`) }), /trailing bytes/);
  assert.throws(() => prepared({ bytes: Buffer.from(`\uFEFF${bytes}`) }), /BOM/);
  assert.throws(() => prepared({ runId: 0 }), /runId/);
  assert.throws(() => prepared({ sourceArtifactId: undefined }), /sourceArtifactId/);
  assert.throws(() => prepared({ objectId: "../../latest" }), /objectId/);
});

test("G03-A01 freezes digest-first publication and repair versus abandonment", () => {
  assert.deepEqual(PUBLICATION_SEQUENCE, [
    "prepare", "config-blob", "linkage", "layer-blob", "manifest-digest",
    "fetch-compare", "attest-verify", "discovery-tag", "ledger",
  ]);
  assert.equal(classifyPublicationFailure({ kind: "transient-api", now: 1, expiresAt: 2, exactBytesAvailable: true }), "R-G03-MM");
  for (const kind of ["source-missing", "authority-drift", "remote-mismatch", "attestation-mismatch", "sentinel-drift"])
    assert.equal(classifyPublicationFailure({ kind, now: 1, expiresAt: 2, exactBytesAvailable: true }), "ABANDON_LINEAGE");
  assert.equal(classifyPublicationFailure({ kind: "transient-api", now: 3, expiresAt: 2, exactBytesAvailable: true }), "ABANDON_LINEAGE");
});

test("G03-A01 records map and ledger only after digest, linkage, fetch, attestation and tag proof", () => {
  const object = prepared();
  const map = { schemaVersion: 1, release: "2.5.0", objects: [] };
  const ledger = { schemaVersion: 1, release: "2.5.0", entries: [] };
  const proof = {
    ...object,
    packageOwner: "dazeGG",
    packageVisibility: "private",
    linkedRepository: "dazeGG/VoiceRoom",
    actor: "dazeGG",
    fetchedManifestDigest: object.manifestDigest,
    fetchedLayerDigest: object.layer.digest,
    attestationVerified: true,
    tagResolvedDigest: object.manifestDigest,
    publishedAt: "2026-07-19T00:00:00.000Z",
  };
  const appended = appendArchiveProof(map, ledger, proof);
  assert.equal(appended.map.objects.length, 1);
  assert.equal(appended.ledger.entries.length, 1);
  assert.equal(appended.map.objects[0].manifestDigest, object.manifestDigest);
  assert.throws(() => appendArchiveProof(appended.map, appended.ledger, proof), /append-only|already/);
  assert.throws(() => appendArchiveProof(map, ledger, { ...proof, attestationVerified: false }), /attestation/);
});

test("G03-A02 recovers purged Actions evidence solely by OCI manifest digest", () => {
  const object = prepared();
  const recovered = verifyRecoveredObject({
    manifestBytes: object.manifestBytes,
    layerBytes: bytes,
    expectedManifestDigest: object.manifestDigest,
    expectedLayerDigest: object.layer.digest,
    expectedObjectId: object.objectId,
    actionsArtifactAvailable: false,
    attestationVerified: true,
  });
  assert.equal(recovered.digestOnly, true);
  assert.deepEqual(recovered.bytes, bytes);
  assert.throws(() => verifyRecoveredObject({ ...recovered, manifestBytes: object.manifestBytes, layerBytes: Buffer.from("{}"), expectedManifestDigest: object.manifestDigest, expectedLayerDigest: object.layer.digest, expectedObjectId: object.objectId, actionsArtifactAvailable: false, attestationVerified: true }), /layer digest/);
  assert.throws(() => verifyRecoveredObject({ manifestBytes: object.manifestBytes, layerBytes: bytes, expectedManifestDigest: object.manifestDigest, expectedLayerDigest: object.layer.digest, expectedObjectId: object.objectId, actionsArtifactAvailable: false, attestationVerified: false }), /attestation/);
  for (const mutate of [
    (manifest) => { manifest.config.size = 3; },
    (manifest) => { manifest.layers[0].size += 1; },
    (manifest) => { manifest.annotations["org.opencontainers.image.title"] = object.objectId; },
    (manifest) => { manifest.annotations.extra = "forbidden"; },
    (manifest) => { manifest.subject = { digest: object.manifestDigest }; },
  ]) {
    const manifest = structuredClone(object.manifest); mutate(manifest); const manifestBytes = Buffer.from(JSON.stringify(manifest));
    assert.throws(() => verifyRecoveredObject({ manifestBytes, layerBytes: bytes, expectedManifestDigest: sha256(manifestBytes), expectedLayerDigest: object.layer.digest,
      expectedObjectId: object.objectId, actionsArtifactAvailable: false, attestationVerified: true }), /manifest|config|annotation|subject/);
  }
});

test("G03-A02 sentinel hard-stops deletion, linkage, actor, visibility, digest and attestation drift", () => {
  const object = prepared();
  const expected = {
    objectId: object.objectId,
    manifestDigest: object.manifestDigest,
    layerDigest: object.layer.digest,
    discoveryTag: object.discoveryTag,
    packageOwner: "dazeGG",
    packageVisibility: "private",
    linkedRepository: "dazeGG/VoiceRoom",
    actor: "dazeGG",
    attestationVerified: true,
  };
  const raw = { manifestBytes: object.manifestBytes, layerBytes: bytes, discoveryTag: object.discoveryTag,
    tagResolvedDigest: object.manifestDigest, package: { owner: { login: "dazeGG" }, visibility: "private", repositories: [{ full_name: "dazeGG/VoiceRoom" }] },
    actor: { login: "dazeGG" }, attestationVerified: true, attestationOutput: "verified" };
  assert.equal(checkArchiveSentinel({ expected: [expected], observed: [{ raw }] }).status, "GREEN");
  assert.throws(() => checkArchiveSentinel({ expected: [expected], observed: [expected] }), /synthetic/);
  for (const mutation of [
    { package: { owner: { login: "dazeGG" }, visibility: "private", repositories: [{ full_name: "dazeGG/VoiceRoom" }, { full_name: "mallory/other" }] } },
    { actor: { login: "mallory" } }, { package: { owner: { login: "dazeGG" }, visibility: "public", repositories: [{ full_name: "dazeGG/VoiceRoom" }] } },
    { tagResolvedDigest: `sha256:${"0".repeat(64)}` }, { attestationVerified: false }, { layerBytes: Buffer.from("{}") },
  ]) assert.throws(() => checkArchiveSentinel({ expected: [expected], observed: [{ raw: { ...raw, ...mutation } }] }), /archive sentinel/);
  assert.equal(deriveLiveObservation(raw).manifestDigest, object.manifestDigest);
});

test("workflows use exact token permissions, pinned attestation, scheduled sentinel and no deletion/PAT flow", () => {
  const archive = fs.readFileSync(".github/workflows/evidence-archive.yml", "utf8");
  const sentinel = fs.readFileSync(".github/workflows/evidence-archive-sentinel.yml", "utf8");
  assert.match(archive, /^  goal-g03-evidence-archive:/m);
  const block = archive.match(/^  goal-g03-evidence-archive:[\s\S]*?^    env:/m)?.[0] ?? archive;
  for (const line of ["contents: read", "packages: write", "id-token: write", "attestations: write"])
    assert.match(block, new RegExp(`^      ${line}$`, "m"));
  assert.match(archive, /actions\/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6/);
  assert.match(archive, /github\.token/);
  assert.match(archive, /scripts\/ci\/run-oras\.sh/);
  assert.match(archive, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(archive, /--validate-sources/);
  assert.match(archive, /--record-batch/);
  assert.match(archive, /blob fetch --output fetched-layer\.json/);
  assert.match(sentinel, /^  schedule:/m);
  assert.match(sentinel, /^      packages: read$/m);
  const sentinelLogin = sentinel.indexOf("uses: docker/login-action@v3");
  const sentinelFetch = sentinel.indexOf("run-oras.sh manifest fetch");
  assert.ok(sentinelLogin > 0 && sentinelLogin < sentinelFetch, "private GHCR login must precede ORAS fetch");
  assert.match(sentinel, /username: \$\{\{ github\.actor \}\}/);
  assert.match(sentinel, /password: \$\{\{ github\.token \}\}/);
  assert.match(sentinel, /check-archive-sentinel\.mjs/);
  assert.match(sentinel, /manifest fetch --output/);
  assert.match(sentinel, /blob fetch --output/);
  assert.doesNotMatch(sentinel, /available:true|attestationVerified:true,tagResolvedDigest:x\.manifestDigest/);
  assert.match(archive, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(archive, /^  push:$/m);
  assert.match(archive, /^    if: github\.event_name == 'workflow_dispatch'$/m);
  assert.match(archive, /^    if: github\.event_name == 'workflow_dispatch' && github\.repository == 'dazeGG\/VoiceRoom' && inputs\.confirm == 'ARCHIVE-G01-G02'$/m);
  assert.doesNotMatch(`${archive}\n${sentinel}`, /\bPAT\b|packages\/.*DELETE|delete-package|oras\s+push|^\s+subject:\s/im);
});

test("tracked archive state is honest before the first authorized external publication", () => {
  const map = JSON.parse(fs.readFileSync("docs/releases/2.5.0/evidence/archive-map.json"));
  const ledger = JSON.parse(fs.readFileSync("docs/releases/2.5.0/evidence/archive-ledger.json"));
  const index = JSON.parse(fs.readFileSync("docs/releases/2.5.0/evidence/index.json"));
  assert.deepEqual(map.objects, []);
  assert.deepEqual(ledger.entries, []);
  assert.equal(index.status, "G03_PRE_PUBLICATION");
  assert.equal(index.archiveAuthority, "archive-authority.json");
});

function semantic(value, field = "digest") {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(Buffer.from(JSON.stringify(copy)));
}

function authenticatedSources() {
  const terminalG01 = SHA("b"), terminalG02 = SHA("c"), g01Head = SHA("d"), g02Head = SHA("e"), ancestorHead = SHA("f");
  const descriptor = (artifactId, value, { runId, runAttempt = 1, headSha, name = `artifact-${artifactId}`, archiveDigest = `sha256:${String(artifactId).padStart(64, "0")}` }) => {
    const sourceBytes = Buffer.from(JSON.stringify(value));
    return { artifactId, runAttempt, bytes: sourceBytes, metadata: { id: artifactId, name, digest: archiveDigest, expired: false, workflow_run: { id: runId, head_sha: headSha } },
      run: { id: runId, run_attempt: runAttempt, head_sha: headSha, repository: { full_name: "dazeGG/VoiceRoom" } } };
  };
  const ancestorValue = { evidenceId: "bootstrap-failure.g01-a19.json" };
  const ancestor = descriptor(2, ancestorValue, { runId: 20, headSha: ancestorHead,
    name: `g01-bootstrap-failure-g01-a19-run-20-attempt-1-head-${ancestorHead}-phase-f11`, archiveDigest: `sha256:${"2".repeat(64)}` });
  const g1f7Value = { evidenceId: ARCHIVE_OBJECT_ORDER[2], status: "GREEN", digest: `sha256:${"3".repeat(64)}` };
  const g1f9Value = { evidenceId: ARCHIVE_OBJECT_ORDER[3], status: "GREEN", digest: `sha256:${"4".repeat(64)}` };
  const g1f11Value = { evidenceId: ARCHIVE_OBJECT_ORDER[4], status: "GREEN", digest: `sha256:${"5".repeat(64)}` };
  const g1f7 = descriptor(3, g1f7Value, { runId: 30, headSha: g01Head,
    name: `g01-candidate-g01-recovery-a27-run-30-attempt-1-head-${g01Head}`, archiveDigest: `sha256:${"6".repeat(64)}` });
  const g1f9 = descriptor(4, g1f9Value, { runId: 30, headSha: g01Head,
    name: `g01-approval-g01-recovery-a27-run-30-attempt-1-head-${g01Head}`, archiveDigest: `sha256:${"7".repeat(64)}` });
  const g1f11 = descriptor(5, g1f11Value, { runId: 31, headSha: terminalG01,
    name: `g01-merge-g01-recovery-a27-run-31-attempt-1-head-${terminalG01}`, archiveDigest: `sha256:${"8".repeat(64)}` });
  const ancestorFailure = { attemptId: "g01-a19", evidenceId: ARCHIVE_OBJECT_ORDER[1], digest: sha256(ancestor.bytes), artifactId: ancestor.artifactId,
    artifactName: ancestor.metadata.name, archiveDigest: ancestor.metadata.digest, runId: ancestor.run.id, runAttempt: ancestor.run.run_attempt,
    headSha: ancestor.run.head_sha, baseSha: SHA("1"), parentSha: SHA("1"), terminalDevelopSha: ancestorHead,
    createdAt: "2026-07-18T00:00:00.000Z", provenance: { kind: "artifactless-run-backfill", authorityDigest: `sha256:${"a".repeat(64)}`,
      producerRunId: ancestor.run.id, producerRunAttempt: ancestor.run.run_attempt, producerHeadSha: ancestor.run.head_sha,
      recoveryTerminalDevelopSha: terminalG01, subjectTerminalDevelopSha: ancestorHead } };
  const selectionValue = { schemaVersion: 1, release: "2.5.0", evidenceId: ARCHIVE_OBJECT_ORDER[0], attemptId: "g01-recovery-a27",
    status: "SELECTED_GREEN", terminalKind: "landed-recovery", terminalDevelopSha: terminalG01, createdAt: "2026-07-19T00:00:00.000Z", remoteDeleted: true,
    f7Id: ARCHIVE_OBJECT_ORDER[2], f7Digest: g1f7Value.digest, f9Id: ARCHIVE_OBJECT_ORDER[3], f9Digest: g1f9Value.digest, f11Id: ARCHIVE_OBJECT_ORDER[4], f11Digest: g1f11Value.digest,
    ancestorFailures: [ancestorFailure],
    artifactBindings: {
      f7: { artifactId: g1f7.artifactId, artifactName: g1f7.metadata.name, archiveDigest: g1f7.metadata.digest, payloadDigest: sha256(g1f7.bytes), runId: g1f7.run.id, runAttempt: 1, headSha: g1f7.run.head_sha },
      f9: { artifactId: g1f9.artifactId, artifactName: g1f9.metadata.name, archiveDigest: g1f9.metadata.digest, payloadDigest: sha256(g1f9.bytes), runId: g1f9.run.id, runAttempt: 1, headSha: g1f9.run.head_sha },
      f11: { artifactId: g1f11.artifactId, artifactName: g1f11.metadata.name, archiveDigest: g1f11.metadata.digest, payloadDigest: sha256(g1f11.bytes), runId: g1f11.run.id, runAttempt: 1, headSha: g1f11.run.head_sha },
    }, bootstrapSupersessionChainDigest: sha256(Buffer.from(JSON.stringify([ancestorFailure]))) };
  selectionValue.selectionDigest = semantic(selectionValue, "selectionDigest");
  const selection = descriptor(1, selectionValue, { runId: 10, headSha: terminalG01, name: "selection", archiveDigest: `sha256:${"1".repeat(64)}` });
  const g2f7Value = { evidenceId: ARCHIVE_OBJECT_ORDER[5], status: "GREEN", baseSha: terminalG01, sourceSha: g02Head,
    selection: { artifactId: selection.artifactId, digest: selectionValue.selectionDigest, terminalDevelopSha: terminalG01 }, producerRun: { id: 40, runAttempt: 5, headSha: g02Head } };
  g2f7Value.digest = semantic(g2f7Value);
  const g2f7 = descriptor(6, g2f7Value, { runId: 40, runAttempt: 5, headSha: g02Head });
  const g2f9Value = { evidenceId: ARCHIVE_OBJECT_ORDER[6], status: "GREEN", sourceSha: g02Head, f7Digest: g2f7Value.digest }; g2f9Value.digest = semantic(g2f9Value);
  const g2f9 = descriptor(7, g2f9Value, { runId: 40, runAttempt: 5, headSha: g02Head });
  const g2f11Value = { evidenceId: ARCHIVE_OBJECT_ORDER[7], status: "GREEN", f7Digest: g2f7Value.digest, f9Digest: g2f9Value.digest,
    terminalDevelopSha: terminalG02, mergeSha: terminalG02 }; g2f11Value.digest = semantic(g2f11Value);
  const g2f11 = descriptor(8, g2f11Value, { runId: 41, headSha: terminalG02 });
  return { sources: [selection, ancestor, g1f7, g1f9, g1f11, g2f7, g2f9, g2f11], terminalG02 };
}

test("G03-A01 authenticates the complete external selection, ancestor and G01/G02 chain", () => {
  const { sources, terminalG02 } = authenticatedSources();
  assert.equal(validateArchiveSourceSet(sources, terminalG02).length, 8);
  const tampered = sources.map((source) => ({ ...source }));
  tampered[2].bytes = Buffer.from('{"evidenceId":"ci-bundle.bootstrap-recovery-a27.json","status":"GREEN","digest":"sha256:tampered"}');
  assert.throws(() => validateArchiveSourceSet(tampered, terminalG02), /G01 f7 authority/);
  assert.throws(() => validateArchiveSourceSet(sources.slice(1), terminalG02), /eight-object/);

  const mutateSelection = (mutate, refreshSelectionDigest = false) => {
    const changed = sources.map((source) => ({ ...source, bytes: Buffer.from(source.bytes) }));
    const value = JSON.parse(changed[0].bytes); mutate(value);
    if (refreshSelectionDigest) value.selectionDigest = semantic(value, "selectionDigest");
    changed[0].bytes = Buffer.from(JSON.stringify(value));
    return changed;
  };
  assert.throws(() => validateArchiveSourceSet(mutateSelection((value) => { value.extra = true; }), terminalG02), /keys.*exactly/);
  assert.throws(() => validateArchiveSourceSet(mutateSelection((value) => { delete value.createdAt; }), terminalG02), /keys.*exactly/);
  assert.throws(() => validateArchiveSourceSet(mutateSelection((value) => { value.artifactBindings.f7.extra = true; }), terminalG02), /keys.*exactly/);
  assert.throws(() => validateArchiveSourceSet(mutateSelection((value) => { delete value.artifactBindings.f7.payloadDigest; }), terminalG02), /keys.*exactly/);
  assert.throws(() => validateArchiveSourceSet(mutateSelection((value) => { value.ancestorFailures[0].terminalDevelopSha = SHA("0"); }, true), terminalG02), /supersession chain digest/);
});

test("G03-A01 aggregates all eight proofs once with contiguous append-only sequences", () => {
  const proofs = ARCHIVE_OBJECT_ORDER.map((objectId, index) => {
    const object = buildArchiveObject({ objectId, sourcePath: objectId, sourceSha: SHA(String((index + 1) % 10)), runId: index + 1, runAttempt: 1, sourceArtifactId: index + 1, bytes: Buffer.from(`{"index":${index}}`) });
    return { ...object, packageOwner: "dazeGG", packageVisibility: "private", linkedRepository: "dazeGG/VoiceRoom", actor: "dazeGG",
      fetchedManifestDigest: object.manifestDigest, fetchedLayerDigest: object.layer.digest, attestationVerified: true, tagResolvedDigest: object.manifestDigest, publishedAt: `2026-07-19T00:00:0${index}.000Z` };
  });
  const state = aggregateArchiveProofs({ schemaVersion: 1, release: "2.5.0", objects: [] }, { schemaVersion: 1, release: "2.5.0", entries: [] }, proofs.reverse(), ARCHIVE_OBJECT_ORDER);
  assert.deepEqual(state.ledger.entries.map((entry) => entry.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(state.map.objects.map((entry) => entry.objectId), ARCHIVE_OBJECT_ORDER);
  assert.throws(() => aggregateArchiveProofs(state.map, { ...state.ledger, entries: state.ledger.entries.slice(1) }, [], []), /diverge|sequence/);
  assert.throws(() => aggregateArchiveProofs({ schemaVersion: 1, release: "2.5.0", objects: [] }, { schemaVersion: 1, release: "2.5.0", entries: [] }, proofs.slice(1), ARCHIVE_OBJECT_ORDER), /incomplete/);
});

test("G03-A02 recovery CLI uses digest-only ORAS fetch, real attestation gate and preserves bytes", () => {
  const object = prepared();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g03-test-"));
  try {
    const manifest = path.join(directory, "manifest.json"), layer = path.join(directory, "layer.json"), output = path.join(directory, "recovered.json");
    fs.writeFileSync(manifest, object.manifestBytes); fs.writeFileSync(layer, bytes);
    const oras = path.join(directory, "oras.sh"), gh = path.join(directory, "gh.sh");
    fs.writeFileSync(oras, `#!/bin/sh\nif [ "$1 $2" = "manifest fetch" ]; then cp '${manifest}' "$4"; elif [ "$1 $2" = "blob fetch" ]; then cp '${layer}' "$4"; else exit 2; fi\n`);
    fs.writeFileSync(gh, '#!/bin/sh\necho verified\n'); fs.chmodSync(oras, 0o755); fs.chmodSync(gh, 0o755);
    const result = spawnSync(process.execPath, ["scripts/evidence/recover-from-oci.mjs", "--reference", "ghcr.io/dazegg/voiceroom-release-evidence", "--digest", object.manifestDigest,
      "--object-id", object.objectId, "--repo", "dazeGG/VoiceRoom", "--output", output, "--oras", oras, "--gh", gh], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(fs.readFileSync(output), bytes);
    fs.writeFileSync(gh, '#!/bin/sh\nexit 1\n');
    const denied = spawnSync(process.execPath, ["scripts/evidence/recover-from-oci.mjs", "--reference", "ghcr.io/dazegg/voiceroom-release-evidence", "--digest", object.manifestDigest,
      "--object-id", object.objectId, "--repo", "dazeGG/VoiceRoom", "--output", `${output}.denied`, "--oras", oras, "--gh", gh], { encoding: "utf8" });
    assert.notEqual(denied.status, 0); assert.equal(fs.existsSync(`${output}.denied`), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
