#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARCHIVE_ARTIFACT_TYPE, sha256 } from "./archive-to-oci.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PACKAGE = /^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const SHA = /^[0-9a-f]{40}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const ANNOTATIONS = [
  "io.voiceroom.evidence.id", "io.voiceroom.github.run-attempt", "io.voiceroom.github.run-id",
  "org.opencontainers.image.revision", "org.opencontainers.image.source", "org.opencontainers.image.title",
].sort();

export function verifyRecoveredObject(input) {
  const { manifestBytes, layerBytes, expectedManifestDigest, expectedLayerDigest, expectedObjectId } = input;
  if (!DIGEST.test(expectedManifestDigest ?? "") || sha256(manifestBytes) !== expectedManifestDigest) throw new Error("manifest digest mismatch");
  if (!DIGEST.test(expectedLayerDigest ?? "") || sha256(layerBytes) !== expectedLayerDigest) throw new Error("layer digest mismatch");
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || manifest.artifactType !== ARCHIVE_ARTIFACT_TYPE ||
      manifest.layers?.length !== 1 || manifest.layers[0].mediaType !== "application/json" || manifest.layers[0].digest !== expectedLayerDigest || manifest.layers[0].size !== layerBytes.length)
    throw new Error("invalid standalone evidence manifest");
  if (Object.hasOwn(manifest, "subject")) throw new Error("subject/referrer evidence is forbidden");
  if (manifest.config?.mediaType !== "application/vnd.oci.empty.v1+json" || manifest.config.digest !== "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" || manifest.config.size !== 2)
    throw new Error("invalid empty config descriptor");
  if (JSON.stringify(Object.keys(manifest.annotations ?? {}).sort()) !== JSON.stringify(ANNOTATIONS) ||
      manifest.annotations["io.voiceroom.evidence.id"] !== expectedObjectId || manifest.annotations["org.opencontainers.image.title"] !== expectedObjectId ||
      manifest.annotations["org.opencontainers.image.source"] !== "https://github.com/dazeGG/VoiceRoom" ||
      !SHA.test(manifest.annotations["org.opencontainers.image.revision"] ?? "") ||
      !POSITIVE.test(manifest.annotations["io.voiceroom.github.run-id"] ?? "") || !POSITIVE.test(manifest.annotations["io.voiceroom.github.run-attempt"] ?? ""))
    throw new Error("evidence identity or annotation mismatch");
  if (input.attestationVerified !== true) throw new Error("manifest attestation is not verified");
  return { bytes: Buffer.from(layerBytes), digestOnly: input.actionsArtifactAvailable === false, manifestDigest: expectedManifestDigest, layerDigest: expectedLayerDigest };
}

function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) out[argv[i].slice(2)] = argv[i + 1]; return out; }

function run(command, args, errorMessage) {
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${errorMessage}: ${result.stderr.toString().trim()}`);
}

function cli(argv) {
  const options = parse(argv);
  if (!DIGEST.test(options.digest ?? "") || !PACKAGE.test(options.reference ?? "") || !options.output || !options.repo || !options["object-id"])
    throw new Error("recovery requires a package, repository, object ID and immutable --digest, never a tag");
  const reference = `${options.reference}@${options.digest}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voiceroom-g03-recovery-"));
  try {
    const manifestPath = path.join(directory, "manifest.json");
    const layerPath = path.join(directory, "layer.json");
    run(options.oras ?? "scripts/ci/run-oras.sh", ["manifest", "fetch", "--output", manifestPath, reference], "OCI manifest fetch failed");
    const manifestBytes = fs.readFileSync(manifestPath);
    if (sha256(manifestBytes) !== options.digest) throw new Error("manifest digest mismatch");
    const manifest = JSON.parse(manifestBytes);
    const layerDigest = manifest.layers?.[0]?.digest;
    if (!DIGEST.test(layerDigest ?? "")) throw new Error("invalid OCI layer descriptor");
    run(options.oras ?? "scripts/ci/run-oras.sh", ["blob", "fetch", "--output", layerPath, `${options.reference}@${layerDigest}`], "OCI layer fetch failed");
    run(options.gh ?? "gh", ["attestation", "verify", `oci://${reference}`, "--repo", options.repo], "OCI attestation verification failed");
    const verified = verifyRecoveredObject({
      manifestBytes, layerBytes: fs.readFileSync(layerPath), expectedManifestDigest: options.digest,
      expectedLayerDigest: layerDigest, expectedObjectId: options["object-id"], actionsArtifactAvailable: false, attestationVerified: true,
    });
    fs.writeFileSync(options.output, verified.bytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
