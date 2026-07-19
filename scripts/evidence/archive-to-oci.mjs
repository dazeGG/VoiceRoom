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
export const ARCHIVE_OBJECT_ORDER = Object.freeze([
  "bootstrap-selection.g01-recovery-a27.json", "bootstrap-failure.g01-a19.json",
  "ci-bundle.bootstrap-recovery-a27.json", "approval-envelope.bootstrap-recovery-a27.json", "merge-envelope.bootstrap-recovery-a27.json",
  "ci-bundle.g02.json", "approval-envelope.g02.json", "merge-envelope.g02.json",
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
  if (Buffer.from(text).compare(bytes) !== 0) throw new Error("evidence bytes are not valid UTF-8");
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
      "org.opencontainers.image.title": objectId,
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
  assertArchiveState(map, ledger);
  if (map.objects.some((entry) => entry.objectId === proof.objectId || entry.manifestDigest === proof.manifestDigest || entry.layerDigest === proof.layer?.digest) ||
      ledger.entries.some((entry) => entry.objectId === proof.objectId || entry.manifestDigest === proof.manifestDigest))
    throw new Error("append-only archive entry already exists");
  const record = proofRecord(proof);
  return {
    map: { ...map, objects: [...map.objects, record] },
    ledger: { ...ledger, entries: [...ledger.entries, { ...record, sequence: ledger.entries.length + 1 }] },
  };
}

function comparableRecord(entry) {
  const { sequence: _sequence, ...record } = entry;
  return record;
}

export function assertArchiveState(map, ledger) {
  if (map?.schemaVersion !== 1 || map.release !== "2.5.0" || !Array.isArray(map.objects)) throw new Error("invalid archive map");
  if (ledger?.schemaVersion !== 1 || ledger.release !== "2.5.0" || !Array.isArray(ledger.entries)) throw new Error("invalid archive ledger");
  if (map.objects.length !== ledger.entries.length) throw new Error("archive map and ledger diverge");
  for (let index = 0; index < ledger.entries.length; index += 1) {
    if (ledger.entries[index].sequence !== index + 1) throw new Error("archive ledger sequence is not contiguous");
    if (JSON.stringify(map.objects[index]) !== JSON.stringify(comparableRecord(ledger.entries[index]))) throw new Error("archive map and ledger diverge");
  }
}

export function aggregateArchiveProofs(map, ledger, proofs, expectedObjectIds) {
  assertArchiveState(map, ledger);
  if (!Array.isArray(proofs) || !Array.isArray(expectedObjectIds) || proofs.length !== expectedObjectIds.length)
    throw new Error("archive aggregate is incomplete");
  const byId = new Map(proofs.map((proof) => [proof.objectId, proof]));
  if (byId.size !== proofs.length || expectedObjectIds.some((id) => !byId.has(id)) || proofs.some((proof) => !expectedObjectIds.includes(proof.objectId)))
    throw new Error("archive aggregate has missing, duplicate, or unexpected objects");
  let state = { map, ledger };
  for (const objectId of expectedObjectIds) state = appendArchiveProof(state.map, state.ledger, byId.get(objectId));
  return state;
}

function semanticDigest(value, field = "digest") {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(Buffer.from(JSON.stringify(copy)));
}

export function validateArchiveSourceSet(sources, terminalDevelopSha) {
  if (!Array.isArray(sources) || sources.length !== ARCHIVE_OBJECT_ORDER.length) throw new Error("complete eight-object source set required");
  const rows = sources.map((source) => {
    exactCompactJson(source.bytes);
    const value = JSON.parse(source.bytes);
    if (source.metadata?.expired !== false || source.metadata?.id !== source.artifactId || source.metadata?.workflow_run?.id !== source.run?.id ||
        source.run?.run_attempt !== source.runAttempt || source.run?.head_sha !== source.metadata?.workflow_run?.head_sha || source.run?.repository?.full_name !== "dazeGG/VoiceRoom")
      throw new Error(`unauthenticated artifact metadata for ${value.evidenceId}`);
    return { ...source, value, rawDigest: sha256(source.bytes) };
  });
  const byId = new Map(rows.map((row) => [row.value.evidenceId, row]));
  if (byId.size !== rows.length || ARCHIVE_OBJECT_ORDER.some((id) => !byId.has(id))) throw new Error("unexpected, missing, or duplicate archive source");
  const selection = byId.get(ARCHIVE_OBJECT_ORDER[0]);
  const s = selection.value;
  if (s.status !== "SELECTED_GREEN" || s.terminalKind !== "landed-recovery" || s.terminalDevelopSha !== byId.get("ci-bundle.g02.json").value.baseSha ||
      semanticDigest(s, "selectionDigest") !== s.selectionDigest) throw new Error("invalid external terminal selection");
  if (s.ancestorFailures.length !== 1) throw new Error("ordered ancestor failure set mismatch");
  const ancestor = byId.get(s.ancestorFailures[0].evidenceId);
  const a = s.ancestorFailures[0];
  if (ancestor.rawDigest !== a.digest || ancestor.artifactId !== a.artifactId || ancestor.metadata.name !== a.artifactName || ancestor.metadata.digest !== a.archiveDigest ||
      ancestor.run.id !== a.provenance.producerRunId || ancestor.run.run_attempt !== a.provenance.producerRunAttempt || ancestor.run.head_sha !== a.provenance.producerHeadSha)
    throw new Error("ancestor failure authority mismatch");
  for (const [phase, id, digestField] of [["f7", s.f7Id, "f7Digest"], ["f9", s.f9Id, "f9Digest"], ["f11", s.f11Id, "f11Digest"]]) {
    const row = byId.get(id), binding = s.artifactBindings[phase];
    if (!row || row.rawDigest !== binding.payloadDigest || row.artifactId !== binding.artifactId || row.metadata.name !== binding.artifactName ||
        row.metadata.digest !== binding.archiveDigest || row.run.id !== binding.runId || row.run.run_attempt !== binding.runAttempt || row.run.head_sha !== binding.headSha ||
        row.value[digestField === "f7Digest" ? "digest" : "digest"] !== s[digestField] || row.value.status !== "GREEN")
      throw new Error(`selected G01 ${phase} authority mismatch`);
  }
  const g02f7 = byId.get("ci-bundle.g02.json"), g02f9 = byId.get("approval-envelope.g02.json"), g02f11 = byId.get("merge-envelope.g02.json");
  if (semanticDigest(g02f7.value) !== g02f7.value.digest || g02f7.value.selection?.artifactId !== selection.artifactId ||
      g02f7.value.selection?.digest !== s.selectionDigest || g02f7.value.selection?.terminalDevelopSha !== s.terminalDevelopSha ||
      g02f7.value.producerRun?.id !== g02f7.run.id || g02f7.value.producerRun?.runAttempt !== g02f7.runAttempt || g02f7.value.producerRun?.headSha !== g02f7.run.head_sha)
    throw new Error("G02 F7 selection authority mismatch");
  if (semanticDigest(g02f9.value) !== g02f9.value.digest || g02f9.value.f7Digest !== g02f7.value.digest || g02f9.value.sourceSha !== g02f7.value.sourceSha)
    throw new Error("G02 F9 authority mismatch");
  if (semanticDigest(g02f11.value) !== g02f11.value.digest || g02f11.value.f7Digest !== g02f7.value.digest || g02f11.value.f9Digest !== g02f9.value.digest ||
      g02f11.value.terminalDevelopSha !== terminalDevelopSha || g02f11.value.mergeSha !== terminalDevelopSha || g02f11.run.head_sha !== terminalDevelopSha)
    throw new Error("G02 F11 terminal authority mismatch");
  return ARCHIVE_OBJECT_ORDER.map((id) => byId.get(id));
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
  if (options["record-batch"]) {
    const proofs = JSON.parse(fs.readFileSync(options.proofs));
    const expectedObjectIds = JSON.parse(fs.readFileSync(options.expected));
    const map = JSON.parse(fs.readFileSync(options.map));
    const ledger = JSON.parse(fs.readFileSync(options.ledger));
    const appended = aggregateArchiveProofs(map, ledger, proofs, expectedObjectIds);
    fs.mkdirSync(options.output, { recursive: true });
    writeJson(path.join(options.output, "archive-map.json"), appended.map);
    writeJson(path.join(options.output, "archive-ledger.json"), appended.ledger);
    return;
  }
  if (options["validate-sources"]) {
    const manifest = JSON.parse(fs.readFileSync(options.sources));
    const sources = manifest.map((source) => ({ ...source, bytes: fs.readFileSync(source.path), metadata: JSON.parse(fs.readFileSync(source.metadataPath)), run: JSON.parse(fs.readFileSync(source.runPath)) }));
    validateArchiveSourceSet(sources, options["terminal-develop-sha"]);
    process.stdout.write(`${JSON.stringify({ status: "AUTHENTICATED", objects: ARCHIVE_OBJECT_ORDER })}\n`);
    return;
  }
  throw new Error("use --prepare, --publish, --record, --record-batch or --validate-sources");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
