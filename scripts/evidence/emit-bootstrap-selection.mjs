#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validateEnvelopeChain } from "./validate-envelope.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function exactKeys(value, allowed, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} has unexpected field: ${key}`);
}

function validateAncestorFailures(value) {
  assert.ok(Array.isArray(value), "ancestorFailures must be an array");
  let previous = -Infinity;
  const ids = new Set();
  const shas = new Set();
  for (const [index, ancestor] of value.entries()) {
    exactKeys(ancestor, ["attemptId", "evidenceId", "digest", "terminalDevelopSha", "createdAt"], `ancestorFailures[${index}]`);
    assert.match(ancestor.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/);
    assert.match(ancestor.evidenceId, /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/);
    assert.match(ancestor.digest, DIGEST);
    assert.match(ancestor.terminalDevelopSha, SHA);
    const timestamp = Date.parse(ancestor.createdAt);
    assert.ok(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === ancestor.createdAt, "ancestor createdAt must be canonical ISO-8601 UTC");
    assert.ok(timestamp > previous, "ancestor failures must be strictly chronological");
    assert.ok(!ids.has(ancestor.attemptId) && !shas.has(ancestor.terminalDevelopSha), "ancestor failures must be unique");
    ids.add(ancestor.attemptId); shas.add(ancestor.terminalDevelopSha); previous = timestamp;
  }
  return value;
}

export function buildSelection(metadata, f7, f9, f11) {
  exactKeys(metadata, ["attemptId", "terminalKind", "ancestorFailures"], "selection metadata");
  assert.ok(["direct-canonical", "landed-recovery"].includes(metadata.terminalKind), "invalid terminalKind");
  const ancestors = validateAncestorFailures(metadata.ancestorFailures);
  const { terminalDevelopSha, lineageSuffix } = validateEnvelopeChain(f7, f9, f11);
  if (metadata.terminalKind === "direct-canonical") {
    assert.match(metadata.attemptId, /^g01-a[0-9]{2,}$/);
    assert.equal(lineageSuffix, "g01.json");
    assert.equal(ancestors.length, 0, "direct canonical selection cannot relabel ancestors");
  } else {
    const match = metadata.attemptId.match(/^g01-recovery-a([0-9]{2,})$/);
    assert.ok(match, "landed recovery attemptId is invalid");
    assert.equal(lineageSuffix, `bootstrap-recovery-a${match[1]}.json`);
    assert.ok(ancestors.length > 0, "landed recovery requires ordered ancestor failures");
    assert.ok(Date.parse(ancestors.at(-1).createdAt) < Date.parse(f7.createdAt), "recovery F7 must follow every ancestor failure");
  }
  const bootstrapSupersessionChainDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(ancestors)).digest("hex")}`;
  return {
    schemaVersion: 1,
    release: "2.5.0",
    attemptId: metadata.attemptId,
    terminalKind: metadata.terminalKind,
    f7Id: f7.evidenceId,
    f7Digest: f7.digest,
    f9Id: f9.evidenceId,
    f9Digest: f9.digest,
    f11Id: f11.evidenceId,
    f11Digest: f11.digest,
    terminalDevelopSha,
    remoteDeleted: true,
    status: "SELECTED_GREEN",
    ancestorFailures: ancestors,
    bootstrapSupersessionChainDigest,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const metadata = JSON.parse(fs.readFileSync(argument("--metadata"), "utf8"));
  const f7 = JSON.parse(fs.readFileSync(argument("--f7"), "utf8"));
  const f9 = JSON.parse(fs.readFileSync(argument("--f9"), "utf8"));
  const f11 = JSON.parse(fs.readFileSync(argument("--f11"), "utf8"));
  process.stdout.write(`${JSON.stringify(buildSelection(metadata, f7, f9, f11))}\n`);
}
