import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ARCHIVE_ARTIFACT_TYPE,
  EMPTY_CONFIG_DIGEST,
  PUBLICATION_SEQUENCE,
  appendArchiveProof,
  buildArchiveObject,
  classifyPublicationFailure,
  sha256,
} from "../evidence/archive-to-oci.mjs";
import { verifyRecoveredObject } from "../evidence/recover-from-oci.mjs";
import { checkArchiveSentinel } from "../evidence/check-archive-sentinel.mjs";

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
});

test("G03-A02 sentinel hard-stops deletion, linkage, actor, visibility, digest and attestation drift", () => {
  const object = prepared();
  const entry = {
    objectId: object.objectId,
    manifestDigest: object.manifestDigest,
    layerDigest: object.layer.digest,
    discoveryTag: object.discoveryTag,
    packageOwner: "dazeGG",
    packageVisibility: "private",
    linkedRepository: "dazeGG/VoiceRoom",
    actor: "dazeGG",
    attestationVerified: true,
    available: true,
    tagResolvedDigest: object.manifestDigest,
  };
  assert.equal(checkArchiveSentinel({ expected: [entry], observed: [entry] }).status, "GREEN");
  for (const mutation of [
    { available: false }, { linkedRepository: "dazeGG/other" }, { actor: "mallory" },
    { packageVisibility: "public" }, { manifestDigest: `sha256:${"0".repeat(64)}` }, { attestationVerified: false },
  ]) assert.throws(() => checkArchiveSentinel({ expected: [entry], observed: [{ ...entry, ...mutation }] }), /archive sentinel/);
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
  assert.match(sentinel, /^  schedule:/m);
  assert.match(sentinel, /check-archive-sentinel\.mjs/);
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
