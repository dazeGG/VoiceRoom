#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const FIELDS = ["objectId", "manifestDigest", "layerDigest", "discoveryTag", "packageOwner", "packageVisibility", "linkedRepository", "actor", "attestationVerified"];
const digest = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

export function deriveLiveObservation(raw) {
  if (!Buffer.isBuffer(raw.manifestBytes) || !Buffer.isBuffer(raw.layerBytes)) throw new Error("archive sentinel: raw remote bytes required");
  const manifest = JSON.parse(raw.manifestBytes);
  const repositories = raw.package?.repository ? [raw.package.repository] : raw.package?.repositories ?? [];
  if (repositories.length !== 1) throw new Error("archive sentinel: package must have exactly one linked repository");
  if (raw.attestationVerified !== true || typeof raw.attestationOutput !== "string" || raw.attestationOutput.trim() === "")
    throw new Error("archive sentinel: live attestation proof missing");
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" ||
      manifest.artifactType !== "application/vnd.voiceroom.release-evidence.v1+json" || manifest.layers?.length !== 1 ||
      manifest.layers[0].mediaType !== "application/json" || manifest.layers[0].digest !== digest(raw.layerBytes) || manifest.layers[0].size !== raw.layerBytes.length ||
      manifest.config?.mediaType !== "application/vnd.oci.empty.v1+json" || manifest.config.digest !== "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" || manifest.config.size !== 2 ||
      Object.hasOwn(manifest, "subject")) throw new Error("archive sentinel: live manifest or layer drift");
  const objectId = manifest.annotations?.["io.voiceroom.evidence.id"];
  if (!objectId || manifest.annotations?.["org.opencontainers.image.title"] !== objectId) throw new Error("archive sentinel: live annotation drift");
  return {
    objectId, manifestDigest: digest(raw.manifestBytes), layerDigest: digest(raw.layerBytes),
    discoveryTag: raw.discoveryTag, packageOwner: raw.package?.owner?.login ?? raw.package?.namespace,
    packageVisibility: raw.package?.visibility, linkedRepository: repositories[0]?.full_name,
    actor: raw.actor?.login, attestationVerified: true, available: true, tagResolvedDigest: raw.tagResolvedDigest,
  };
}

export function checkArchiveSentinel({ expected, observed }) {
  if (!Array.isArray(expected) || !Array.isArray(observed) || expected.length !== observed.length) throw new Error("archive sentinel: deletion or count drift");
  const live = observed.map((entry) => {
    if (!entry?.raw) throw new Error("archive sentinel: synthetic observations are forbidden");
    return deriveLiveObservation(entry.raw);
  });
  const byId = new Map(live.map((entry) => [entry.objectId, entry]));
  if (byId.size !== live.length) throw new Error("archive sentinel: duplicate object observation");
  for (const wanted of expected) {
    const actual = byId.get(wanted.objectId);
    if (!actual || actual.available !== true) throw new Error(`archive sentinel: ${wanted.objectId} unavailable`);
    for (const field of FIELDS) if (actual[field] !== wanted[field]) throw new Error(`archive sentinel: ${wanted.objectId} ${field} drift`);
    if (actual.tagResolvedDigest !== wanted.manifestDigest) throw new Error(`archive sentinel: ${wanted.objectId} discovery tag drift`);
  }
  return { schemaVersion: 1, release: "2.5.0", status: "GREEN", checked: expected.length };
}

function cli(argv) {
  const index = argv.indexOf("--linkage-report");
  if (index !== -1) {
    const report = JSON.parse(fs.readFileSync(argv[index + 1]));
    if (report.owner !== "dazeGG" || report.visibility !== "private" || report.linkedRepository !== "dazeGG/VoiceRoom" || report.actor !== "dazeGG")
      throw new Error("archive sentinel: package linkage authority drift");
    return;
  }
  const expectedPath = argv[argv.indexOf("--expected") + 1];
  const observedPath = argv[argv.indexOf("--observed") + 1];
  const outputPath = argv[argv.indexOf("--output") + 1];
  const expected = JSON.parse(fs.readFileSync(expectedPath)).objects;
  const observed = JSON.parse(fs.readFileSync(observedPath)).objects.map((entry) => ({ raw: {
    ...entry, manifestBytes: fs.readFileSync(entry.manifestPath), layerBytes: fs.readFileSync(entry.layerPath),
    package: JSON.parse(fs.readFileSync(entry.packagePath)), actor: JSON.parse(fs.readFileSync(entry.actorPath)),
    attestationOutput: fs.readFileSync(entry.attestationPath, "utf8"),
  } }));
  const report = checkArchiveSentinel({ expected, observed });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
