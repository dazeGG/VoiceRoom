#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { assertRuntimePublicationRecord, readRuntimeConfig } from "./build-publish.mjs";

export function verifyRuntimeProvenance(record, config = readRuntimeConfig()) {
  return assertRuntimePublicationRecord(record, config);
}

function main(argv = process.argv.slice(2)) {
  const file = argv[argv.indexOf("--record") + 1];
  if (!file || argv.indexOf("--record") === -1) throw new Error("usage: verify-runtime-provenance.mjs --record FILE");
  verifyRuntimeProvenance(JSON.parse(fs.readFileSync(file, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
