#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const FIELDS = ["objectId", "manifestDigest", "layerDigest", "discoveryTag", "packageOwner", "packageVisibility", "linkedRepository", "actor", "attestationVerified"];

export function checkArchiveSentinel({ expected, observed }) {
  if (!Array.isArray(expected) || !Array.isArray(observed) || expected.length !== observed.length) throw new Error("archive sentinel: deletion or count drift");
  const byId = new Map(observed.map((entry) => [entry.objectId, entry]));
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
  const observed = JSON.parse(fs.readFileSync(observedPath)).objects;
  const report = checkArchiveSentinel({ expected, observed });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
