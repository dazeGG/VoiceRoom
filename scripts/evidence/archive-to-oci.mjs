#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ARCHIVE_ARTIFACT_TYPE = "application/vnd.voiceroom.release-evidence.v1+json";
export const EMPTY_CONFIG_DIGEST = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
export const PACKAGE = "ghcr.io/dazegg/voiceroom-release-evidence";
export const PUBLICATION_SEQUENCE = Object.freeze([
  "prepare", "config-blob", "linkage", "layer-blob", "manifest-digest",
  "fetch-compare", "attest-verify", "discovery-tag", "ledger",
]);

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const OBJECT_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function exactCompactJson(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("bytes must be a Buffer");
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error("evidence bytes contain a BOM");
  const text = bytes.toString("utf8");
  const jsonText = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (jsonText.endsWith("\n") || jsonText.endsWith("\r")) throw new Error("evidence bytes contain non-canonical trailing bytes");
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error("evidence bytes must be JSON"); }
  if (JSON.stringify(parsed) !== jsonText) throw new Error("evidence bytes must be compact JSON with at most one terminal LF");
}

function positiveInteger(value, name) {
  if (!POSITIVE.test(String(value))) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

export function buildArchiveObject(input) {
  const {
    objectId, sourcePath, sourceSha, bytes,
    packageName = PACKAGE,
  } = input;
  if (!OBJECT_ID.test(objectId ?? "") || objectId.includes("..")) throw new Error("invalid objectId");
  if (typeof sourcePath !== "string" || !sourcePath) throw new Error("sourcePath is required");
  if (!SHA.test(sourceSha ?? "")) throw new Error("sourceSha must be a commit SHA");
  const runId = positiveInteger(input.runId, "runId");
  const runAttempt = positiveInteger(input.runAttempt, "runAttempt");
  const sourceArtifactId = positiveInteger(input.sourceArtifactId, "sourceArtifactId");
  exactCompactJson(bytes);
  const layer = { mediaType: "application/json", digest: sha256(bytes), size: bytes.length };
  const config = { mediaType: "application/vnd.oci.empty.v1+json", digest: EMPTY_CONFIG_DIGEST, size: 2 };
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    artifactType: ARCHIVE_ARTIFACT_TYPE,
    config,
    layers: [layer],
    annotations: {
      "org.opencontainers.image.source": "https://github.com/dazeGG/VoiceRoom",
      "org.opencontainers.image.revision": sourceSha,
      "io.voiceroom.github.run-id": String(runId),
      "io.voiceroom.github.run-attempt": String(runAttempt),
      "io.voiceroom.evidence.id": objectId,
    },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestDigest = sha256(manifestBytes);
  const normalized = objectId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const discoveryTag = `evidence-${normalized}-${manifestDigest.slice(7, 19)}-run${runId}-attempt${runAttempt}`;
  return {
    schemaVersion: 1, release: "2.5.0", objectId, sourcePath, sourceSha,
    sourceArtifactId, runId, runAttempt, package: packageName, config, layer,
    manifest, manifestBytes, manifestDigest, reference: `${packageName}@${manifestDigest}`,
    discoveryTag, publicationSequence: [...PUBLICATION_SEQUENCE],
  };
}

export function classifyPublicationFailure({ kind, now, expiresAt, exactBytesAvailable }) {
  const permanent = new Set(["source-missing", "authority-drift", "remote-mismatch", "attestation-mismatch", "sentinel-drift"]);
  if (permanent.has(kind) || !exactBytesAvailable || !Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt)
    return "ABANDON_LINEAGE";
  return kind === "transient-api" || kind === "partial-upload" || kind === "attestation-missing"
    ? "R-G03-MM" : "ABANDON_LINEAGE";
}

function proofRecord(proof) {
  for (const [key, value] of Object.entries({
    manifestDigest: proof.manifestDigest,
    fetchedManifestDigest: proof.fetchedManifestDigest,
    layerDigest: proof.layer?.digest,
    fetchedLayerDigest: proof.fetchedLayerDigest,
    tagResolvedDigest: proof.tagResolvedDigest,
  })) if (!DIGEST.test(value ?? "")) throw new Error(`${key} is invalid`);
  if (proof.fetchedManifestDigest !== proof.manifestDigest || proof.tagResolvedDigest !== proof.manifestDigest)
    throw new Error("remote manifest or discovery tag mismatch");
  if (proof.fetchedLayerDigest !== proof.layer.digest) throw new Error("remote layer mismatch");
  if (proof.attestationVerified !== true) throw new Error("manifest attestation is not verified");
  if (proof.packageOwner !== "dazeGG" || proof.packageVisibility !== "private" || proof.linkedRepository !== "dazeGG/VoiceRoom" || proof.actor !== "dazeGG")
    throw new Error("package authority or linkage drift");
  return {
    objectId: proof.objectId, sourcePath: proof.sourcePath, sourceArtifactId: proof.sourceArtifactId,
    sourceSha: proof.sourceSha, runId: proof.runId, runAttempt: proof.runAttempt,
    package: proof.package, manifestDigest: proof.manifestDigest, layerDigest: proof.layer.digest,
    discoveryTag: proof.discoveryTag, packageOwner: proof.packageOwner,
    packageVisibility: proof.packageVisibility, linkedRepository: proof.linkedRepository,
    actor: proof.actor, attestationVerified: true, publishedAt: proof.publishedAt,
  };
}

export function appendArchiveProof(map, ledger, proof) {
  if (map?.schemaVersion !== 1 || map.release !== "2.5.0" || !Array.isArray(map.objects)) throw new Error("invalid archive map");
  if (ledger?.schemaVersion !== 1 || ledger.release !== "2.5.0" || !Array.isArray(ledger.entries)) throw new Error("invalid archive ledger");
  if (map.objects.some((entry) => entry.objectId === proof.objectId || entry.manifestDigest === proof.manifestDigest) ||
      ledger.entries.some((entry) => entry.objectId === proof.objectId || entry.manifestDigest === proof.manifestDigest))
    throw new Error("append-only archive entry already exists");
  const record = proofRecord(proof);
  return {
    map: { ...map, objects: [...map.objects, record] },
    ledger: { ...ledger, entries: [...ledger.entries, { ...record, sequence: ledger.entries.length + 1 }] },
  };
}

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) result[key.slice(2)] = true;
    else { result[key.slice(2)] = value; i += 1; }
  }
  return result;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  return result.stdout.trim();
}

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function cli(argv) {
  const options = args(argv);
  if (options.prepare) {
    const output = path.resolve(options.output);
    fs.mkdirSync(output, { recursive: true });
    const sourceBytes = fs.readFileSync(options.source);
    const object = buildArchiveObject({
      objectId: options["object-id"], sourcePath: options.source, sourceSha: options["source-sha"],
      runId: options["run-id"], runAttempt: options["run-attempt"], sourceArtifactId: options["artifact-id"], bytes: sourceBytes,
    });
    fs.writeFileSync(path.join(output, "config.json"), "{}");
    fs.writeFileSync(path.join(output, "layer.json"), sourceBytes);
    fs.writeFileSync(path.join(output, "manifest.json"), object.manifestBytes);
    writeJson(path.join(output, "object.json"), { ...object, manifestBytes: undefined });
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `config-digest=${object.config.digest}\nlayer-digest=${object.layer.digest}\nmanifest-digest=${object.manifestDigest}\ndiscovery-tag=${object.discoveryTag}\n`);
    else process.stdout.write(`${JSON.stringify({ manifestDigest: object.manifestDigest, discoveryTag: object.discoveryTag })}\n`);
    return;
  }
  if (options.publish) {
    const directory = path.resolve(options.object);
    const object = JSON.parse(fs.readFileSync(path.join(directory, "object.json")));
    const oras = options.oras ?? "scripts/ci/run-oras.sh";
    run(oras, ["blob", "push", "--media-type", object.config.mediaType, `${object.package}@${object.config.digest}`, path.join(directory, "config.json")]);
    run(process.execPath, [fileURLToPath(new URL("./check-archive-sentinel.mjs", import.meta.url)), "--linkage-report", options["linkage-report"]]);
    run(oras, ["blob", "push", "--media-type", object.layer.mediaType, `${object.package}@${object.layer.digest}`, path.join(directory, "layer.json")]);
    run(oras, ["manifest", "push", object.reference, path.join(directory, "manifest.json")]);
    const fetched = run(oras, ["manifest", "fetch", object.reference]);
    if (sha256(Buffer.from(fetched)) !== object.manifestDigest) throw new Error("fetched manifest digest mismatch");
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest-digest=${object.manifestDigest}\ndiscovery-tag=${object.discoveryTag}\n`);
    return;
  }
  if (options.record) {
    const proof = JSON.parse(fs.readFileSync(options.proof));
    const map = JSON.parse(fs.readFileSync(options.map));
    const ledger = JSON.parse(fs.readFileSync(options.ledger));
    const appended = appendArchiveProof(map, ledger, proof);
    fs.mkdirSync(options.output, { recursive: true });
    writeJson(path.join(options.output, "archive-map.json"), appended.map);
    writeJson(path.join(options.output, "archive-ledger.json"), appended.ledger);
    return;
  }
  throw new Error("use --prepare, --publish or --record");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
