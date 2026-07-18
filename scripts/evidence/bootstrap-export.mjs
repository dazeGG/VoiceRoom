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
  assert.equal(Number(attempt.attemptId.match(/[0-9]+$/)[0]), attempt.ordinal, "attempt ID suffix must equal ordinal");
  for (const key of ["headSha", "baseSha", "parentSha"]) assert.match(attempt[key], SHA);
  for (const key of ["authorityDigest", "planSpecPairDigest"]) assert.match(attempt[key], DIGEST);
  assert.ok((typeof attempt.firstAuthoritativeId === "string" && attempt.firstAuthoritativeId.length > 0) || (Number.isInteger(attempt.firstAuthoritativeId) && attempt.firstAuthoritativeId > 0));
}

function validateRecovery(recovery, index) {
  exactKeys(recovery, ["attemptId", "branch", "baseSha", "parentSha", "headSha", "authorityDigest", "planSpecPairDigest", "firstAuthoritativeId", "priorFailureId", "priorFailureDigest"], `landedAncestors[${index}]`);
  const match = recovery.attemptId.match(/^g01-recovery-a([0-9]{2,})$/);
  assert.ok(match);
  assert.equal(Number(match[1]), index + 2, "recovery attempts must continue the direct-attempt ordinal without gaps");
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
    assert.ok(registry.ordinalReconstruction.reason.length > 0, "ordinal reconstruction reason must be nonempty");
    if (registry.state === "G01_PRE_BRANCH") assert.equal(registry.currentAttempt, null, "PRE_BRANCH cannot retain a canonical current pointer");
    if (registry.state === "G01_PREMERGE_ACTIVE") assert.notEqual(registry.currentAttempt, null, "PREMERGE_ACTIVE requires a canonical current pointer");
    if (registry.ordinalReconstruction.complete) assert.equal(registry.ordinalReconstruction.nextOrdinal, Math.max(0, ...ordinals) + 1, "complete reconstruction must name the next observed ordinal");
    else assert.equal(registry.ordinalReconstruction.nextOrdinal, null, "incomplete reconstruction cannot predict an ordinal");
  } else if (filename === "bootstrap-landed-recoveries.json") {
    exactKeys(registry, ["currentRecovery", "landedAncestors", "release", "schemaVersion", "state"], filename);
    assert.ok(Array.isArray(registry.landedAncestors));
    registry.landedAncestors.forEach(validateRecovery);
    validatePointer(registry.currentRecovery, registry.landedAncestors, "currentRecovery");
    const ids = registry.landedAncestors.map(({ attemptId }) => attemptId);
    assert.equal(new Set(ids).size, ids.length, "recovery attempt IDs must be unique");
    for (const recovery of registry.landedAncestors) assert.equal(recovery.parentSha, recovery.baseSha, "recovery parent must equal its frozen base");
    if (registry.state === "G01_PRE_BRANCH") assert.equal(registry.currentRecovery, null, "PRE_BRANCH cannot retain a recovery pointer");
    if (registry.state === "G01_PREMERGE_ACTIVE" && registry.landedAncestors.length > 0) assert.notEqual(registry.currentRecovery, null, "active recovery requires its current pointer");
  } else {
    throw new Error(`unsupported bootstrap registry: ${filename}`);
  }
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.release, "2.5.0");
  assert.ok(["G01_PRE_BRANCH", "G01_PREMERGE_ACTIVE", "G01_LANDED_UNSEALED"].includes(registry.state), "candidate registry cannot claim terminal selection");
  return registry;
}

export function buildCandidateReport(inputs) {
  assert.ok(Array.isArray(inputs) && inputs.length === 2, "exactly two bootstrap registries are required");
  assert.deepEqual(inputs.map(({ filename }) => path.basename(filename)).sort(), ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"], "both canonical registry basenames are required exactly once");
  const registries = inputs.map(({ filename, bytes }) => {
    const candidate = validateRegistry(JSON.parse(bytes), path.basename(filename));
    return { name: path.basename(filename), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), candidate };
  });
  assert.equal(registries[0].candidate.state, registries[1].candidate.state, "bootstrap registries must agree on current state");
  return { schemaVersion: 1, release: "2.5.0", registries };
}

function activeIdentity(candidateReport, sourceSha, sourceBranch) {
  const named = new Map(candidateReport.registries.map(({ name, candidate }) => [name, candidate]));
  if (sourceBranch === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    const registry = named.get("bootstrap-attempts.json");
    assert.equal(registry?.state, "G01_PREMERGE_ACTIVE", "direct F7 requires an active reconstructed attempt");
    const matches = registry.attempts.filter(({ attemptId }) => attemptId === registry.currentAttempt);
    assert.equal(matches.length, 1, "direct current attempt must resolve exactly once");
    const current = matches[0];
    assert.equal(current.branch, sourceBranch); assert.equal(current.headSha, sourceSha);
    assert.equal(Number(current.attemptId.match(/^g01-a([0-9]{2,})$/)?.[1]), current.ordinal, "direct attempt ID must bind its reconstructed ordinal");
    return { attemptId: current.attemptId, suffix: "g01.json" };
  }
  const suffix = sourceBranch.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/)?.[1];
  assert.ok(suffix, "F7 source branch is not canonical");
  assert.ok(Number(suffix) >= 2, "recovery ordinal must follow the direct attempt");
  const registry = named.get("bootstrap-landed-recoveries.json");
  assert.equal(registry?.state, "G01_PREMERGE_ACTIVE", "recovery F7 requires an active reconstructed attempt");
  const matches = registry.landedAncestors.filter(({ attemptId }) => attemptId === registry.currentRecovery);
  assert.equal(matches.length, 1, "recovery current attempt must resolve exactly once");
  const current = matches[0];
  assert.equal(current.branch, sourceBranch); assert.equal(current.headSha, sourceSha);
  assert.equal(current.attemptId, `g01-recovery-a${suffix}`, "recovery attempt/branch suffix mismatch");
  return { attemptId: current.attemptId, suffix: `bootstrap-recovery-a${suffix}.json` };
}

export function buildF7Envelope(candidateReport, sourceSha, sourceBranch, createdAt) {
  assert.match(sourceSha, SHA);
  const identity = activeIdentity(candidateReport, sourceSha, sourceBranch);
  const timestamp = Date.parse(createdAt);
  assert.ok(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === createdAt, "F7 createdAt must be canonical ISO-8601 UTC");
  const reportBytes = Buffer.from(JSON.stringify(candidateReport));
  return validateEnvelope({
    schemaVersion: 1,
    goal: "G01",
    phase: "F7",
    status: "GREEN",
    evidenceId: `ci-bundle.${identity.suffix}`,
    attemptId: identity.attemptId,
    sourceBranch,
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
  const excluded = new Set(["--f7", "--source-sha", "--source-branch", "--created-at", ...(args.includes("--source-sha") ? [option("--source-sha")] : []), ...(args.includes("--source-branch") ? [option("--source-branch")] : []), ...(args.includes("--created-at") ? [option("--created-at")] : [])]);
  const files = args.filter((value) => !excluded.has(value));
  if (files.length === 0) throw new Error("usage: bootstrap-export.mjs REGISTRY.json [REGISTRY.json]");
  const report = buildCandidateReport(files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })));
  const output = f7 ? buildF7Envelope(report, option("--source-sha"), option("--source-branch"), option("--created-at")) : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
