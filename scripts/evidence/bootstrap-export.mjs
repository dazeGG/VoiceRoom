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
  assert.ok(Number(match[1]) >= 2, "recovery attempts must follow the direct attempt");
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

function canonicalHistoricalIdentities(authority) {
  const current = new Set([authority.pr.id, authority.pr.number, authority.pr.node_id]);
  const prs = authority.prPages.flatMap((page) => Array.isArray(page) ? page : []).filter((item) => !current.has(item.id) && !current.has(item.number) && !current.has(item.node_id));
  const runs = authority.runPages.flatMap((page) => page.workflow_runs ?? []);
  const artifacts = authority.artifactPages.flatMap((page) => page.artifacts ?? []);
  const rows = [];
  for (const pr of prs) {
    const branch = pr.head?.ref;
    const branchMatch = branch?.match(/^feature\/2\.5\.0-g01-(canonical-evidence-bootstrap|postmerge-bootstrap-a([0-9]{2,}))$/);
    if (!branchMatch) continue;
    assert.match(pr.head?.sha ?? "", SHA, "canonical historical PR head is required");
    assert.equal(pr.head?.repo?.full_name, authority.repository, "canonical historical PR repository mismatch");
    assert.equal(pr.base?.repo?.full_name, authority.repository, "canonical historical PR base repository mismatch");
    assert.equal(pr.base?.ref, "develop", "canonical historical PR base mismatch");
    const exactRuns = runs.filter((run) => run.event === "pull_request" && run.path === ".github/workflows/ci.yml" && run.repository?.full_name === authority.repository && run.head_sha === pr.head.sha && run.head_branch === branch);
    const authenticated = [];
    for (const run of exactRuns) {
      const pattern = new RegExp(`^g01-(?:candidate|approval|bootstrap-failure)-(g01-(?:recovery-)?a([0-9]{2,}))-run-${run.id}-attempt-${run.run_attempt}-head-${pr.head.sha}(?:-phase-(?:f11|selection))?$`);
      for (const artifact of artifacts) {
        const match = artifact.name?.match(pattern);
        if (!match || artifact.expired || artifact.workflow_run?.id !== run.id) continue;
        const ordinal = Number(match[2]);
        if (branchMatch[2]) assert.equal(ordinal, Number(branchMatch[2]), "historical recovery PR/artifact suffix conflict");
        else assert.match(match[1], /^g01-a[0-9]{2,}$/, "direct PR cannot authenticate a recovery identity");
        authenticated.push({ ordinal, attemptId: match[1], prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id, branch, headSha: pr.head.sha, runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id, artifactName: artifact.name });
      }
    }
    assert.ok(authenticated.length > 0, `unreconciled canonical historical PR identity: ${pr.number ?? pr.id}`);
    rows.push(...authenticated);
  }
  const byOrdinal = new Map();
  for (const row of rows) {
    const identity = JSON.stringify({ attemptId: row.attemptId, prId: row.prId, prNumber: row.prNumber, prNodeId: row.prNodeId, branch: row.branch, headSha: row.headSha });
    const prior = byOrdinal.get(row.ordinal);
    if (prior && prior !== identity) throw new Error(`conflicting canonical historical PR identity for ordinal ${row.ordinal}`);
    byOrdinal.set(row.ordinal, identity);
  }
  return rows.sort((a, b) => a.ordinal - b.ordinal || a.runId - b.runId || a.artifactId - b.artifactId);
}

function ordinalId(ordinal) { return String(ordinal).padStart(2, "0"); }

export function reconstructNextOrdinal(candidateReport, authority) {
  exactKeys(authority, ["repository", "pr", "currentRun", "headCommit", "prPages", "runPages", "artifactPages", "paginationComplete", "capture", "observedAt", "priorFailure"], "bootstrap activation authority");
  assert.equal(authority.paginationComplete, true, "all PR/run/artifact pages must be completely consumed");
  validateActivationCapture(authority);
  const tracked = candidateReport.registries.flatMap(({ candidate }) => [...(candidate.attempts ?? []), ...(candidate.landedAncestors ?? [])]).map((item) => Number(item.attemptId.match(/[0-9]+$/)?.[0])).filter(Number.isInteger);
  const identities = canonicalHistoricalIdentities(authority);
  assert.deepEqual(authority.capture.normalizedIdentities, identities, "persisted normalized historical identities mismatch");
  const observedMax = Math.max(0, ...tracked, ...identities.map(({ ordinal }) => ordinal));
  assert.equal(authority.capture.observedMax, observedMax, "persisted observed maximum mismatch");
  return observedMax + 1;
}

function captureDigest(capture) {
  const core = structuredClone(capture); delete core.reconstructionDigest;
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex")}`;
}

export function buildActivationCapture(authority, candidateReport) {
  const hash = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  const pageHashes = (values) => values.map((value, index) => ({ index, sha256: hash(value) }));
  const normalizedIdentities = canonicalHistoricalIdentities(authority);
  const tracked = candidateReport.registries.flatMap(({ candidate }) => [...(candidate.attempts ?? []), ...(candidate.landedAncestors ?? [])]).map((item) => Number(item.attemptId.match(/[0-9]+$/)?.[0])).filter(Number.isInteger);
  const capture = {
    queries: {
      pr: { endpoint: `repos/${authority.repository}/pulls/${authority.pr.number}`, variables: { prNumber: authority.pr.number } },
      currentRun: { endpoint: `repos/${authority.repository}/actions/runs/${authority.currentRun.id}`, variables: { runId: authority.currentRun.id } },
      headCommit: { endpoint: `repos/${authority.repository}/commits/${authority.pr.head.sha}`, variables: { sha: authority.pr.head.sha } },
      prs: { endpoint: `repos/${authority.repository}/pulls`, variables: { state: "all", per_page: 100 } },
      runs: { endpoint: `repos/${authority.repository}/actions/workflows/ci.yml/runs`, variables: { per_page: 100 } },
      artifacts: { endpoint: `repos/${authority.repository}/actions/artifacts`, variables: { per_page: 100 } },
    },
    responses: { pr: hash(authority.pr), currentRun: hash(authority.currentRun), headCommit: hash(authority.headCommit) },
    pages: { prs: pageHashes(authority.prPages), runs: pageHashes(authority.runPages), artifacts: pageHashes(authority.artifactPages) },
    pagination: Object.fromEntries([["prs", authority.prPages], ["runs", authority.runPages], ["artifacts", authority.artifactPages]].map(([name, values]) => [name, { pageOrder: values.map((_, index) => index), endMarker: "gh-api--paginate-completed-no-next-page" }])),
    facts: { prNumber: authority.pr.number, prId: authority.pr.id, prNodeId: authority.pr.node_id, runId: authority.currentRun.id, runAttempt: authority.currentRun.run_attempt, headSha: authority.pr.head.sha, headBranch: authority.pr.head.ref },
    normalizedIdentities,
    observedMax: Math.max(0, ...tracked, ...normalizedIdentities.map(({ ordinal }) => ordinal)),
  };
  capture.reconstructionDigest = captureDigest(capture);
  return capture;
}

function validateActivationCapture(authority) {
  exactKeys(authority.capture, ["queries", "responses", "pages", "pagination", "facts", "normalizedIdentities", "observedMax", "reconstructionDigest"], "activation capture");
  exactKeys(authority.capture.queries, ["pr", "currentRun", "headCommit", "prs", "runs", "artifacts"], "activation queries");
  assert.deepEqual(authority.capture.queries, {
    pr: { endpoint: `repos/${authority.repository}/pulls/${authority.pr.number}`, variables: { prNumber: authority.pr.number } },
    currentRun: { endpoint: `repos/${authority.repository}/actions/runs/${authority.currentRun.id}`, variables: { runId: authority.currentRun.id } },
    headCommit: { endpoint: `repos/${authority.repository}/commits/${authority.pr.head.sha}`, variables: { sha: authority.pr.head.sha } },
    prs: { endpoint: `repos/${authority.repository}/pulls`, variables: { state: "all", per_page: 100 } },
    runs: { endpoint: `repos/${authority.repository}/actions/workflows/ci.yml/runs`, variables: { per_page: 100 } },
    artifacts: { endpoint: `repos/${authority.repository}/actions/artifacts`, variables: { per_page: 100 } },
  }, "activation query variables mismatch");
  exactKeys(authority.capture.responses, ["pr", "currentRun", "headCommit"], "activation response hashes");
  exactKeys(authority.capture.pages, ["prs", "runs", "artifacts"], "activation page hashes");
  exactKeys(authority.capture.pagination, ["prs", "runs", "artifacts"], "activation pagination");
  exactKeys(authority.capture.facts, ["prNumber", "prId", "prNodeId", "runId", "runAttempt", "headSha", "headBranch"], "activation facts");
  for (const value of Object.values(authority.capture.responses)) assert.match(value, DIGEST);
  assert.equal(authority.capture.responses.pr, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.pr)).digest("hex")}`);
  assert.equal(authority.capture.responses.currentRun, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.currentRun)).digest("hex")}`);
  assert.equal(authority.capture.responses.headCommit, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.headCommit)).digest("hex")}`);
  for (const [name, pages] of Object.entries(authority.capture.pages)) {
    assert.ok(Array.isArray(pages) && pages.length > 0, `${name} page hashes must be nonempty`);
    for (const [index, page] of pages.entries()) {
      exactKeys(page, ["index", "sha256"], `${name} page hash ${index}`); assert.equal(page.index, index); assert.match(page.sha256, DIGEST);
    }
  }
  for (const [name, values] of [["prs", authority.prPages], ["runs", authority.runPages], ["artifacts", authority.artifactPages]]) {
    assert.equal(authority.capture.pages[name].length, values.length, `${name} page hash count mismatch`);
    values.forEach((value, index) => assert.equal(authority.capture.pages[name][index].sha256, `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`, `${name} page hash mismatch at ${index}`));
    assert.deepEqual(authority.capture.pagination[name], { pageOrder: values.map((_, index) => index), endMarker: "gh-api--paginate-completed-no-next-page" }, `${name} pagination proof mismatch`);
  }
  assert.deepEqual(authority.capture.facts, { prNumber: authority.pr.number, prId: authority.pr.id, prNodeId: authority.pr.node_id, runId: authority.currentRun.id, runAttempt: authority.currentRun.run_attempt, headSha: authority.pr.head.sha, headBranch: authority.pr.head.ref });
  assert.match(authority.capture.reconstructionDigest, DIGEST);
  assert.equal(authority.capture.reconstructionDigest, captureDigest(authority.capture), "activation reconstruction digest mismatch");
}

export function activateCandidateReport(candidateReport, authority, planBytes, specBytes) {
  assert.equal(authority.pr?.state, "open", "active bootstrap PR must be open");
  assert.equal(authority.pr?.base?.ref, "develop", "bootstrap PR must target develop");
  assert.equal(authority.pr?.base?.repo?.full_name, authority.repository, "bootstrap base repository mismatch");
  assert.equal(authority.pr?.head?.repo?.full_name, authority.repository, "fork bootstrap PR is forbidden");
  assert.equal(authority.currentRun?.event, "pull_request", "bootstrap activation must come from a pull_request run");
  assert.equal(authority.currentRun?.head_sha, authority.pr?.head?.sha, "run/PR head mismatch");
  assert.equal(authority.currentRun?.head_branch, authority.pr?.head?.ref, "run/PR branch mismatch");
  assert.ok(Number.isInteger(authority.currentRun?.id) && authority.currentRun.id > 0, "authoritative workflow run ID is required");
  assert.ok(Number.isInteger(authority.currentRun?.run_attempt) && authority.currentRun.run_attempt > 0, "authoritative workflow run attempt is required");
  assert.match(authority.pr.head.sha, SHA); assert.match(authority.pr.base.sha, SHA);
  assert.equal(authority.headCommit?.sha, authority.pr.head.sha, "head commit substitution");
  assert.ok(Array.isArray(authority.headCommit?.parents) && authority.headCommit.parents.length >= 1, "head commit parent is required");
  assert.match(authority.headCommit.parents[0].sha, SHA);
  const observedAt = Date.parse(authority.observedAt);
  assert.ok(Number.isFinite(observedAt) && new Date(observedAt).toISOString() === authority.observedAt, "activation observation must be canonical UTC");

  const activated = structuredClone(candidateReport);
  const named = new Map(activated.registries.map((entry) => [entry.name, entry.candidate]));
  const attempts = named.get("bootstrap-attempts.json"); const recoveries = named.get("bootstrap-landed-recoveries.json");
  assert.equal(attempts.state, "G01_PRE_BRANCH", "tracked direct registry must be PRE_BRANCH before atomic activation");
  assert.equal(recoveries.state, "G01_PRE_BRANCH", "tracked recovery registry must be PRE_BRANCH before atomic activation");
  assert.equal(attempts.currentAttempt, null); assert.equal(recoveries.currentRecovery, null);
  const ordinal = reconstructNextOrdinal(candidateReport, authority); const suffix = ordinalId(ordinal);
  const authorityDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify({ repository: authority.repository, prId: authority.pr.id, prNodeId: authority.pr.node_id, prNumber: authority.pr.number, runId: authority.currentRun.id, runAttempt: authority.currentRun.run_attempt, headSha: authority.pr.head.sha, observedAt: authority.observedAt })).digest("hex")}`;
  const planSpecPairDigest = `sha256:${crypto.createHash("sha256").update(Buffer.concat([Buffer.from(String(planBytes.length)), Buffer.from(":"), planBytes, Buffer.from(String(specBytes.length)), Buffer.from(":"), specBytes])).digest("hex")}`;
  const common = { baseSha: authority.pr.base.sha, parentSha: authority.headCommit.parents[0].sha, headSha: authority.pr.head.sha, authorityDigest, planSpecPairDigest, firstAuthoritativeId: `pr:${authority.pr.node_id}:run:${authority.currentRun.id}:attempt:${authority.currentRun.run_attempt}` };
  if (authority.pr.head.ref === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    const attemptId = `g01-a${suffix}`;
    assert.equal(attempts.attempts.some((entry) => entry.ordinal === ordinal || entry.attemptId === attemptId), false, "reconstructed direct ordinal is already consumed");
    attempts.attempts.push({ attemptId, ordinal, branch: authority.pr.head.ref, ...common }); attempts.currentAttempt = attemptId;
  } else {
    const branchOrdinal = authority.pr.head.ref.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/)?.[1];
    assert.ok(branchOrdinal, "bootstrap branch is not canonical"); assert.equal(Number(branchOrdinal), ordinal, "recovery branch must use 1+max observed/consumed ordinal");
    exactKeys(authority.priorFailure, ["evidenceId", "digest", "terminalDevelopSha", "recoveryLineage"], "prior failure authority");
    assert.match(authority.priorFailure.evidenceId, /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/); assert.match(authority.priorFailure.digest, DIGEST); assert.match(authority.priorFailure.terminalDevelopSha, SHA);
    assert.equal(authority.pr.base.sha, authority.priorFailure.terminalDevelopSha, "recovery must base on the frozen failed develop SHA");
    assert.ok(Array.isArray(authority.priorFailure.recoveryLineage), "prior failure recovery lineage must be present");
    const priorAttemptId = authority.priorFailure.evidenceId.slice("bootstrap-failure.".length, -".json".length);
    const lineageOrdinals = authority.priorFailure.recoveryLineage.map((entry) => Number(entry.attemptId.match(/[0-9]+$/)?.[0]));
    assert.equal(new Set(lineageOrdinals).size, lineageOrdinals.length, "prior recovery lineage ordinals must be unique");
    assert.deepEqual(lineageOrdinals, [...lineageOrdinals].sort((a, b) => a - b), "prior recovery lineage must preserve immutable ordinal order");
    assert.ok(lineageOrdinals.every((value) => value < ordinal), "prior recovery lineage cannot contain the current/future attempt");
    if (priorAttemptId.startsWith("g01-recovery-")) {
      assert.ok(authority.priorFailure.recoveryLineage.length > 0, "recovery-after-recovery requires the complete prior lineage");
      assert.equal(authority.priorFailure.recoveryLineage.at(-1).attemptId, priorAttemptId, "prior recovery failure must terminate the carried lineage");
    } else assert.equal(authority.priorFailure.recoveryLineage.length, 0, "direct failure cannot claim recovery ancestry");
    if (recoveries.landedAncestors.length === 0 && authority.priorFailure.recoveryLineage.length > 0) recoveries.landedAncestors = structuredClone(authority.priorFailure.recoveryLineage);
    else assert.deepEqual(recoveries.landedAncestors, authority.priorFailure.recoveryLineage, "tracked and authenticated recovery lineage disagree");
    recoveries.landedAncestors.forEach(validateRecovery);
    const attemptId = `g01-recovery-a${suffix}`;
    recoveries.landedAncestors.push({ attemptId, branch: authority.pr.head.ref, ...common, priorFailureId: authority.priorFailure.evidenceId, priorFailureDigest: authority.priorFailure.digest }); recoveries.currentRecovery = attemptId;
  }
  attempts.state = "G01_PREMERGE_ACTIVE"; recoveries.state = "G01_PREMERGE_ACTIVE";
  attempts.ordinalReconstruction = { complete: true, nextOrdinal: ordinal + 1, reason: "1+max over complete authenticated PR/run/artifact history and tracked consumed ordinals" };
  activated.registries = activated.registries.map((entry) => ({ ...entry, candidate: named.get(entry.name) }));
  activated.activationAuthority = structuredClone(authority.capture);
  return { report: activated, identity: activeIdentity(activated, authority.pr.head.sha, authority.pr.head.ref), ordinal };
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
  const activationPath = args.includes("--activate-authority") ? option("--activate-authority") : undefined;
  const optionNames = ["--source-sha", "--source-branch", "--created-at", "--activate-authority", "--plan", "--spec"];
  const excluded = new Set(["--f7", ...optionNames, ...optionNames.filter((name) => args.includes(name)).map(option)]);
  const files = args.filter((value) => !excluded.has(value));
  if (files.length === 0) throw new Error("usage: bootstrap-export.mjs REGISTRY.json [REGISTRY.json]");
  let report = buildCandidateReport(files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })));
  if (activationPath) report = activateCandidateReport(report, JSON.parse(fs.readFileSync(activationPath, "utf8")), fs.readFileSync(option("--plan")), fs.readFileSync(option("--spec"))).report;
  const output = f7 ? buildF7Envelope(report, option("--source-sha"), option("--source-branch"), option("--created-at")) : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
