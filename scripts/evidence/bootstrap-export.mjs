#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validateEnvelope } from "./validate-envelope.mjs";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function isFutureField(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(review|reviewer|verifier)/.test(normalized)
    || /^(f9|f11)/.test(normalized)
    || /^(merge|develop|deletion|remotedeleted|terminal|selection)/.test(normalized);
}

function exactKeys(value, allowed, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} has unexpected field: ${key}`);
}

function rejectFutureFacts(value, location = "candidate") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectFutureFacts(item, `${location}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (isFutureField(key)) throw new Error(`candidate predicts future field: ${location}.${key}`);
    rejectFutureFacts(child, `${location}.${key}`);
  }
}

function validateAttempt(attempt, index) {
  exactKeys(attempt, ["attemptId", "ordinal", "branch", "headSha", "baseSha", "parentSha", "authorityDigest", "planSpecPairDigest", "firstAuthoritativeId"], `attempts[${index}]`);
  assert.match(attempt.attemptId, /^g01-a[0-9]{2,}$/);
  assert.equal(attempt.branch, "feature/2.5.0-g01-canonical-evidence-bootstrap");
  assert.ok(Number.isInteger(attempt.ordinal) && attempt.ordinal > 0);
  for (const key of ["headSha", "baseSha", "parentSha"]) assert.match(attempt[key], SHA);
  for (const key of ["authorityDigest", "planSpecPairDigest"]) assert.match(attempt[key], DIGEST);
  assert.ok((typeof attempt.firstAuthoritativeId === "string" && attempt.firstAuthoritativeId.length > 0) || (Number.isInteger(attempt.firstAuthoritativeId) && attempt.firstAuthoritativeId > 0));
}

function validateRecovery(recovery, index) {
  exactKeys(recovery, ["attemptId", "branch", "baseSha", "parentSha", "headSha", "authorityDigest", "planSpecPairDigest", "firstAuthoritativeId", "priorFailureId", "priorFailureDigest"], `landedAncestors[${index}]`);
  const match = recovery.attemptId.match(/^g01-recovery-a([0-9]{2,})$/);
  assert.ok(match);
  assert.equal(recovery.branch, `feature/2.5.0-g01-postmerge-bootstrap-a${match[1]}`);
  for (const key of ["baseSha", "parentSha", "headSha"]) assert.match(recovery[key], SHA);
  for (const key of ["authorityDigest", "planSpecPairDigest", "priorFailureDigest"]) assert.match(recovery[key], DIGEST);
  assert.ok(typeof recovery.priorFailureId === "string" && recovery.priorFailureId.length > 0);
  assert.ok((typeof recovery.firstAuthoritativeId === "string" && recovery.firstAuthoritativeId.length > 0) || (Number.isInteger(recovery.firstAuthoritativeId) && recovery.firstAuthoritativeId > 0));
}

function validatePointer(pointer, entries, label) {
  assert.ok(pointer === null || typeof pointer === "string", `${label} pointer must be null or an attempt ID`);
  if (pointer !== null) assert.equal(entries.filter(({ attemptId }) => attemptId === pointer).length, 1, `${label} pointer must resolve exactly once`);
}

export function validateRegistry(registry, filename) {
  rejectFutureFacts(registry);
  if (filename === "bootstrap-attempts.json") {
    exactKeys(registry, ["attempts", "currentAttempt", "ordinalReconstruction", "release", "schemaVersion", "state"], filename);
    exactKeys(registry.ordinalReconstruction, ["complete", "nextOrdinal", "reason"], "ordinalReconstruction");
    assert.ok(Array.isArray(registry.attempts));
    registry.attempts.forEach(validateAttempt);
    validatePointer(registry.currentAttempt, registry.attempts, "currentAttempt");
    const ids = registry.attempts.map(({ attemptId }) => attemptId);
    const ordinals = registry.attempts.map(({ ordinal }) => ordinal);
    assert.equal(new Set(ids).size, ids.length, "attempt IDs must be unique");
    assert.equal(new Set(ordinals).size, ordinals.length, "attempt ordinals must be unique");
    assert.equal(typeof registry.ordinalReconstruction.complete, "boolean");
    assert.ok(registry.ordinalReconstruction.nextOrdinal === null || (Number.isInteger(registry.ordinalReconstruction.nextOrdinal) && registry.ordinalReconstruction.nextOrdinal > 0));
    assert.equal(typeof registry.ordinalReconstruction.reason, "string");
  } else if (filename === "bootstrap-landed-recoveries.json") {
    exactKeys(registry, ["currentRecovery", "landedAncestors", "release", "schemaVersion", "state"], filename);
    assert.ok(Array.isArray(registry.landedAncestors));
    registry.landedAncestors.forEach(validateRecovery);
    validatePointer(registry.currentRecovery, registry.landedAncestors, "currentRecovery");
    const ids = registry.landedAncestors.map(({ attemptId }) => attemptId);
    assert.equal(new Set(ids).size, ids.length, "recovery attempt IDs must be unique");
    for (let index = 1; index < registry.landedAncestors.length; index++) {
      assert.equal(registry.landedAncestors[index].parentSha, registry.landedAncestors[index - 1].baseSha, "recovery ancestry must remain ordered and frozen");
    }
  } else {
    throw new Error(`unsupported bootstrap registry: ${filename}`);
  }
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.release, "2.5.0");
  assert.ok(["G01_PRE_BRANCH", "G01_PREMERGE_ACTIVE", "G01_LANDED_UNSEALED"].includes(registry.state), "candidate registry cannot claim terminal selection");
  return registry;
}

export function buildCandidateReport(inputs) {
  assert.ok(Array.isArray(inputs) && inputs.length > 0, "at least one bootstrap registry is required");
  const registries = inputs.map(({ filename, bytes }) => {
    const candidate = validateRegistry(JSON.parse(bytes), path.basename(filename));
    return { name: path.basename(filename), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), candidate };
  });
  if (registries.length === 2) assert.equal(registries[0].candidate.state, registries[1].candidate.state, "bootstrap registries must agree on current state");
  return { schemaVersion: 1, release: "2.5.0", registries };
}

export function buildF7Envelope(candidateReport, sourceSha, createdAt) {
  assert.match(sourceSha, SHA);
  const timestamp = Date.parse(createdAt);
  assert.ok(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === createdAt, "F7 createdAt must be canonical ISO-8601 UTC");
  const reportBytes = Buffer.from(JSON.stringify(candidateReport));
  return validateEnvelope({
    schemaVersion: 1,
    goal: "G01",
    phase: "F7",
    status: "GREEN",
    evidenceId: "ci-bundle.g01.json",
    sourceSha,
    digest: `sha256:${crypto.createHash("sha256").update(reportBytes).digest("hex")}`,
    createdAt,
  }, "F7");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const f7 = args.includes("--f7");
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
    return args[index + 1];
  };
  const excluded = new Set(["--f7", "--source-sha", "--created-at", ...(args.includes("--source-sha") ? [option("--source-sha")] : []), ...(args.includes("--created-at") ? [option("--created-at")] : [])]);
  const files = args.filter((value) => !excluded.has(value));
  if (files.length === 0) throw new Error("usage: bootstrap-export.mjs REGISTRY.json [REGISTRY.json]");
  const report = buildCandidateReport(files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })));
  const output = f7 ? buildF7Envelope(report, option("--source-sha"), option("--created-at")) : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
