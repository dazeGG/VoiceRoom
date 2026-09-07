#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_CONFIG_PATH = "config/oci/runtime-packages.v1.json";
export const RUNTIME_PUBLICATION_SEQUENCE = Object.freeze([
  "build-once",
  "generate-sbom",
  "generate-provenance",
  "push-by-digest",
  "verify-digest",
  "record-environment-digests",
]);

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE = /^ghcr\.io\/dazegg\/voiceroom-(api|web|worker|musicbot)$/;
const IDS = ["api", "web", "worker", "musicbot"];

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function readRuntimeConfig(configPath = RUNTIME_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function validateRuntimeConfig(config) {
  if (config?.schemaVersion !== 1 || config.release !== "2.5.0" || config.repository !== "dazeGG/VoiceRoom")
    throw new Error("runtime config identity is invalid");
  if (config.evidencePackage !== "ghcr.io/dazegg/voiceroom-release-evidence")
    throw new Error("evidence package identity is invalid");
  if (config.requirements?.immutableDigestOnly !== true || config.requirements?.sbomRequired !== true ||
      config.requirements?.provenanceRequired !== true || config.requirements?.deploymentHostBuildAllowed !== false ||
      config.requirements?.mustNotUseEvidencePackage !== true)
    throw new Error("runtime publication requirements are incomplete");
  if (!Array.isArray(config.nonProductionEnvironments) ||
      JSON.stringify(config.nonProductionEnvironments) !== JSON.stringify(["release-candidate", "staging"]))
    throw new Error("runtime publication must bind the two non-production environments");
  const packages = config.runtimePackages;
  if (!Array.isArray(packages) || packages.length !== IDS.length) throw new Error(`runtime packages must be ${IDS.join("/")} only`);
  for (const id of IDS) {
    const row = packages.find((candidate) => candidate.id === id);
    if (!row || !IMAGE.test(row.image) || row.image === config.evidencePackage ||
        row.dockerTarget !== id || row.composeVariable !== `VOICEROOM_${id.toUpperCase()}_IMAGE`)
      throw new Error(`invalid runtime package ${id}`);
  }
  if (new Set(packages.map((row) => row.image)).size !== IDS.length) throw new Error("runtime images must be separate packages");
  return config;
}

export function buildRuntimePublicationRecord({ config, sourceSha, digests, sboms, provenance }) {
  validateRuntimeConfig(config);
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? "")) throw new Error("sourceSha must be a commit SHA");
  const packages = config.runtimePackages.map((runtimePackage) => {
    const digest = digests?.[runtimePackage.id];
    const sbomDigest = sboms?.[runtimePackage.id];
    const provenanceDigest = provenance?.[runtimePackage.id];
    if (!DIGEST.test(digest ?? "")) throw new Error(`missing immutable digest for ${runtimePackage.id}`);
    if (!DIGEST.test(sbomDigest ?? "")) throw new Error(`missing SBOM digest for ${runtimePackage.id}`);
    if (!DIGEST.test(provenanceDigest ?? "")) throw new Error(`missing provenance digest for ${runtimePackage.id}`);
    if (digest === sbomDigest || digest === provenanceDigest) throw new Error(`runtime artifact digests are ambiguous for ${runtimePackage.id}`);
    return { ...runtimePackage, digest, reference: `${runtimePackage.image}@${digest}`, sbomDigest, provenanceDigest };
  });
  const environments = Object.fromEntries(config.nonProductionEnvironments.map((name) => [
    name,
    Object.fromEntries(packages.map((runtimePackage) => [runtimePackage.id, runtimePackage.reference])),
  ]));
  return {
    schemaVersion: 1,
    release: config.release,
    sourceSha,
    publicationSequence: [...RUNTIME_PUBLICATION_SEQUENCE],
    packages,
    environments,
    evidencePackageUsed: false,
    deploymentHostBuild: false,
    digest: sha256(Buffer.from(JSON.stringify({ sourceSha, packages, environments }))),
  };
}

export function assertRuntimePublicationRecord(record, config = readRuntimeConfig()) {
  validateRuntimeConfig(config);
  if (record?.schemaVersion !== 1 || record.release !== config.release || record.evidencePackageUsed !== false ||
      record.deploymentHostBuild !== false || JSON.stringify(record.publicationSequence) !== JSON.stringify(RUNTIME_PUBLICATION_SEQUENCE))
    throw new Error("runtime publication record does not match the immutable publication contract");
  const ids = record.packages?.map((runtimePackage) => runtimePackage.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...IDS].sort())) throw new Error("runtime publication record is missing a package");
  for (const runtimePackage of record.packages) {
    const expected = config.runtimePackages.find((row) => row.id === runtimePackage.id);
    if (!expected || runtimePackage.image !== expected.image || runtimePackage.reference !== `${expected.image}@${runtimePackage.digest}` ||
        !DIGEST.test(runtimePackage.digest) || !DIGEST.test(runtimePackage.sbomDigest) || !DIGEST.test(runtimePackage.provenanceDigest))
      throw new Error(`runtime package ${runtimePackage.id} has invalid provenance`);
  }
  const expectedRefs = Object.fromEntries(record.packages.map((runtimePackage) => [runtimePackage.id, runtimePackage.reference]));
  for (const environment of config.nonProductionEnvironments) {
    if (JSON.stringify(record.environments?.[environment]) !== JSON.stringify(expectedRefs))
      throw new Error("non-production environments do not consume identical immutable digests");
  }
  return record;
}

export function assertDeploymentComposeUsesDigests(composeText) {
  const services = new Map([
    ["api", { image: "API" }],
    ["caddy", { image: "WEB" }],
    ["message-delivery", { image: "WORKER", worker: "message-delivery" }],
    ["notification-delivery", { image: "WORKER", worker: "notification-delivery" }],
    ["media-processing", { image: "WORKER", worker: "media-processing" }],
    ["media-maintenance", { image: "WORKER", worker: "media-maintenance" }],
    ["media-reconciliation", { image: "WORKER", worker: "media-reconciliation" }],
    ["music-bot", { image: "MUSICBOT" }],
  ]);
  for (const [service, expected] of services) {
    const block = composeText.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|\\z)`, "m"))?.[0] ?? "";
    if (!block) throw new Error(`${service} service is absent`);
    if (/^\s+build:/m.test(block)) throw new Error(`${service} service must not build on the deployment host`);
    const imageLine = 'image: ${VOICEROOM_' + expected.image +
      '_IMAGE:?set immutable VOICEROOM_' + expected.image + '_IMAGE digest}';
    if (!block.split("\n").some((line) => line.trim() === imageLine))
      throw new Error(`${service} service must consume an immutable digest variable`);
    if (expected.worker && !block.split("\n").some((line) => line.trim() === `VOICE_ROOM_WORKER: ${expected.worker}`))
      throw new Error(`${service} service must select its worker entrypoint`);
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) args.set(arg, argv[index + 1]?.startsWith("--") ? true : argv[++index] ?? true);
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = validateRuntimeConfig(readRuntimeConfig(String(args.get("--config") ?? RUNTIME_CONFIG_PATH)));
  if (args.has("--verify-config")) {
    assertDeploymentComposeUsesDigests(fs.readFileSync("docker-compose.yml", "utf8"));
    return;
  }
  if (!args.has("--fixture")) throw new Error("live runtime publication is disabled in this release slice; pass --fixture for offline verification");
  const fixture = JSON.parse(fs.readFileSync(String(args.get("--fixture")), "utf8"));
  const record = buildRuntimePublicationRecord({ config, ...fixture });
  assertRuntimePublicationRecord(record, config);
  if (args.has("--output")) fs.writeFileSync(String(args.get("--output")), `${JSON.stringify(record)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
