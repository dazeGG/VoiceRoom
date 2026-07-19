#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARCHIVE_ARTIFACT_TYPE, sha256 } from "./archive-to-oci.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function verifyRecoveredObject(input) {
  const { manifestBytes, layerBytes, expectedManifestDigest, expectedLayerDigest, expectedObjectId } = input;
  if (!DIGEST.test(expectedManifestDigest ?? "") || sha256(manifestBytes) !== expectedManifestDigest) throw new Error("manifest digest mismatch");
  if (!DIGEST.test(expectedLayerDigest ?? "") || sha256(layerBytes) !== expectedLayerDigest) throw new Error("layer digest mismatch");
  const manifest = JSON.parse(manifestBytes);
  if (manifest.artifactType !== ARCHIVE_ARTIFACT_TYPE || manifest.layers?.length !== 1 || manifest.layers[0].mediaType !== "application/json" || manifest.layers[0].digest !== expectedLayerDigest)
    throw new Error("invalid standalone evidence manifest");
  if (Object.hasOwn(manifest, "subject")) throw new Error("subject/referrer evidence is forbidden");
  if (manifest.annotations?.["io.voiceroom.evidence.id"] !== expectedObjectId) throw new Error("evidence identity mismatch");
  if (input.attestationVerified !== true) throw new Error("manifest attestation is not verified");
  return { bytes: Buffer.from(layerBytes), digestOnly: input.actionsArtifactAvailable === false, manifestDigest: expectedManifestDigest, layerDigest: expectedLayerDigest };
}

function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) out[argv[i].slice(2)] = argv[i + 1]; return out; }

function cli(argv) {
  const options = parse(argv);
  if (!DIGEST.test(options.digest ?? "") || options.reference?.includes(":")) throw new Error("recovery requires a package plus immutable --digest, never a tag");
  const reference = `${options.reference}@${options.digest}`;
  const result = spawnSync(options.oras ?? "scripts/ci/run-oras.sh", ["manifest", "fetch", reference], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("OCI manifest fetch failed");
  const manifestBytes = Buffer.from(result.stdout.trim());
  if (sha256(manifestBytes) !== options.digest) throw new Error("manifest digest mismatch");
  const manifest = JSON.parse(manifestBytes);
  const layer = spawnSync(options.oras ?? "scripts/ci/run-oras.sh", ["blob", "fetch", reference, manifest.layers[0].digest], { encoding: null });
  if (layer.status !== 0) throw new Error("OCI layer fetch failed");
  fs.writeFileSync(options.output, layer.stdout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
