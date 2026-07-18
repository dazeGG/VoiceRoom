#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
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
  const candidateFacts = structuredClone(registry); delete candidateFacts.preparedAuthority; rejectFutureFacts(candidateFacts);
  if (filename === "bootstrap-attempts.json") {
    exactKeys(registry, ["attempts", "currentAttempt", "ordinalReconstruction", "preparedAuthority", "release", "schemaVersion", "state"], filename);
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
    if (registry.preparedAuthority !== undefined) validatePreparedRecord(registry.preparedAuthority);
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

function canonicalHistoricalIdentities(authority, { preBranch = false } = {}) {
  const current = authority.pr ? new Set([authority.pr.id, authority.pr.number, authority.pr.node_id]) : new Set();
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
        if (!match || artifact.workflow_run?.id !== run.id) continue;
        const ordinal = Number(match[2]);
        if (branchMatch[2]) assert.equal(ordinal, Number(branchMatch[2]), "historical recovery PR/artifact suffix conflict");
        else assert.match(match[1], /^g01-a[0-9]{2,}$/, "direct PR cannot authenticate a recovery identity");
        authenticated.push({ ordinal, attemptId: match[1], prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id, branch, headSha: pr.head.sha, runId: run.id, runAttempt: run.run_attempt, artifactId: artifact.id, artifactName: artifact.name, artifactExpired: artifact.expired === true });
      }
    }
    if (preBranch && authenticated.length === 0) {
      const ordinal = branchMatch[2] ? Number(branchMatch[2]) : 1;
      authenticated.push({ ordinal, attemptId: branchMatch[2] ? `g01-recovery-a${ordinalId(ordinal)}` : "g01-a01", prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id, branch, headSha: pr.head.sha, runId: null, runAttempt: null, artifactId: null, artifactName: null, artifactExpired: null, prState: pr.state, mergedAt: pr.merged_at ?? null });
    }
    assert.ok(authenticated.length > 0, `unreconciled canonical historical PR identity: ${pr.number ?? pr.id}`);
    rows.push(...authenticated);
  }
  const byOrdinal = new Map();
  for (const row of rows) {
    const identity = JSON.stringify({ attemptId: row.attemptId, prId: row.prId, prNumber: row.prNumber, prNodeId: row.prNodeId, branch: row.branch, headSha: row.headSha });
    const prior = byOrdinal.get(row.ordinal);
    if (prior && prior !== identity && !preBranch) throw new Error(`conflicting canonical historical PR identity for ordinal ${row.ordinal}`);
    byOrdinal.set(row.ordinal, identity);
  }
  return rows.sort((a, b) => a.ordinal - b.ordinal || a.runId - b.runId || a.artifactId - b.artifactId);
}

function ordinalId(ordinal) { return String(ordinal).padStart(2, "0"); }

function hashJson(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function prepareBootstrapAuthority(candidateReport, authority) {
  exactKeys(authority, ["repository", "developRef", "refs", "prPages", "runPages", "artifactPages", "paginationComplete", "observedAt"], "pre-branch authority");
  assert.equal(authority.paginationComplete, true, "pre-branch preparation requires complete pagination");
  assert.match(authority.developRef?.object?.sha ?? "", SHA, "pre-branch develop ref is required");
  const observed = Date.parse(authority.observedAt);
  assert.ok(Number.isFinite(observed) && new Date(observed).toISOString() === authority.observedAt, "pre-branch observation must be canonical UTC");
  const normalizedIdentities = canonicalHistoricalIdentities(authority, { preBranch: true });
  const tracked = candidateReport.registries.flatMap(({ candidate }) => [...(candidate.attempts ?? []), ...(candidate.landedAncestors ?? [])]).map((item) => Number(item.attemptId.match(/[0-9]+$/)?.[0])).filter(Number.isInteger);
  const artifactOrdinals = authority.artifactPages.flatMap((page) => page.artifacts ?? []).flatMap((artifact) => {
    const match = artifact.name?.match(/^g01-(?:candidate|approval|merge|bootstrap-failure|selection|bootstrap-preparation)-(?:g01-)?(?:recovery-)?a([0-9]{2,})-/);
    return match ? [Number(match[1])] : [];
  });
  const conflicts = [];
  const byOrdinal = new Map();
  for (const row of normalizedIdentities) {
    const identity = JSON.stringify({ prId: row.prId, branch: row.branch, headSha: row.headSha });
    if (byOrdinal.has(row.ordinal) && byOrdinal.get(row.ordinal) !== identity) conflicts.push(row.ordinal);
    else byOrdinal.set(row.ordinal, identity);
  }
  const canonicalRefs = (authority.refs ?? []).filter((ref) => /^refs\/heads\/feature\/2\.5\.0-g01-(?:canonical-evidence-bootstrap|postmerge-bootstrap-a[0-9]{2,})$/.test(ref.ref ?? ""));
  const canonicalPrs = authority.prPages.flatMap((page) => Array.isArray(page) ? page : []).filter((pr) => /^feature\/2\.5\.0-g01-(?:canonical-evidence-bootstrap|postmerge-bootstrap-a[0-9]{2,})$/.test(pr.head?.ref ?? ""));
  const openBranches = new Set(canonicalPrs.filter((pr) => pr.state === "open").map((pr) => pr.head.ref));
  const knownBranches = new Set(canonicalPrs.map((pr) => pr.head.ref));
  const refBranches = canonicalRefs.map((ref) => ref.ref.slice("refs/heads/".length));
  const activeBranches = [...new Set([...openBranches])].sort();
  const abandonedBranches = canonicalPrs.filter((pr) => pr.state === "closed" && !pr.merged_at).map((pr) => pr.head.ref);
  const cleanupBranches = authority.refs === undefined ? abandonedBranches.sort() : refBranches.filter((branch) => !openBranches.has(branch) && (abandonedBranches.includes(branch) || !knownBranches.has(branch))).sort();
  const observedMax = Math.max(0, ...tracked, ...artifactOrdinals, ...normalizedIdentities.map(({ ordinal }) => ordinal));
  const nextOrdinal = observedMax + 1;
  const suffix = ordinalId(nextOrdinal);
  const directConsumed = observedMax > 0;
  const illegalDirect = directConsumed && refBranches.includes("feature/2.5.0-g01-canonical-evidence-bootstrap");
  if (illegalDirect) conflicts.push(1);
  const attemptId = directConsumed ? `g01-recovery-a${suffix}` : `g01-a${suffix}`;
  const branchName = directConsumed ? `feature/2.5.0-g01-postmerge-bootstrap-a${suffix}` : "feature/2.5.0-g01-canonical-evidence-bootstrap";
  const replayRecord = {
    queries: {
      refs: { endpoint: `repos/${authority.repository}/git/matching-refs/heads/feature/2.5.0-g01-`, variables: {} },
      developRef: { endpoint: `repos/${authority.repository}/git/ref/heads/develop`, variables: {} },
      prs: { endpoint: `repos/${authority.repository}/pulls`, variables: { state: "all", per_page: 100 } },
      runs: { endpoint: `repos/${authority.repository}/actions/workflows/ci.yml/runs`, variables: { per_page: 100 } },
      artifacts: { endpoint: `repos/${authority.repository}/actions/artifacts`, variables: { per_page: 100 }, includesExpiredMetadata: true },
    },
    responses: { developRef: hashJson(authority.developRef), refs: hashJson(authority.refs ?? []) },
    snapshots: { developRef: structuredClone(authority.developRef), refs: structuredClone(authority.refs ?? []), prPages: structuredClone(authority.prPages), runPages: structuredClone(authority.runPages), artifactPages: structuredClone(authority.artifactPages) },
    pages: Object.fromEntries([["prs", authority.prPages], ["runs", authority.runPages], ["artifacts", authority.artifactPages]].map(([name, pages]) => [name, pages.map((page, index) => ({ index, sha256: hashJson(page) }))])),
    pagination: Object.fromEntries([["prs", authority.prPages], ["runs", authority.runPages], ["artifacts", authority.artifactPages]].map(([name, pages]) => [name, { pageOrder: pages.map((_, index) => index), endMarker: "gh-api--paginate-completed-no-next-page" }])),
    normalizedIdentities,
    expiredArtifactOrdinals: [...new Set(authority.artifactPages.flatMap((page) => page.artifacts ?? []).filter(({ expired }) => expired === true).flatMap((artifact) => artifact.name?.match(/a([0-9]{2,})/)?.[1] ? [Number(artifact.name.match(/a([0-9]{2,})/)[1])] : []))].sort((a, b) => a - b),
    observedMax,
    reconstructionDigest: hashJson({ normalizedIdentities, artifactOrdinals: [...artifactOrdinals].sort((a, b) => a - b), tracked: [...tracked].sort((a, b) => a - b), observedMax }),
  };
  const authorityDigest = hashJson(replayRecord);
  const status = conflicts.length ? "WAITING_CONFLICT" : activeBranches.length ? "WAITING_ACTIVE_BRANCH" : "READY";
  return { schemaVersion: 1, release: "2.5.0", status, repository: authority.repository, observedAt: authority.observedAt, developSha: authority.developRef.object.sha, nextOrdinal, attemptId, branchName, cleanupBranches, activeBranches, conflicts: [...new Set(conflicts)].sort((a, b) => a - b), authorityDigest, replayRecord };
}


function validatePreparedRecord(prepared) {
  exactKeys(prepared, ["schemaVersion", "release", "status", "repository", "observedAt", "developSha", "nextOrdinal", "attemptId", "branchName", "cleanupBranches", "activeBranches", "conflicts", "authorityDigest", "replayRecord"], "prepared authority");
  assert.equal(prepared.schemaVersion, 1); assert.equal(prepared.release, "2.5.0"); assert.equal(prepared.status, "READY");
  assert.match(prepared.developSha, SHA); assert.match(prepared.authorityDigest, DIGEST);
  assert.equal(prepared.authorityDigest, hashJson(prepared.replayRecord));
  assert.deepEqual(prepared.cleanupBranches, []); assert.deepEqual(prepared.activeBranches, []); assert.deepEqual(prepared.conflicts, []);
  assert.equal(prepared.replayRecord.observedMax + 1, prepared.nextOrdinal);
  return prepared;
}

export async function prepareAndCreateBootstrapBranch({ api, repository, registries, planBytes, specBytes, priorFailure = null, observedAt = () => new Date().toISOString(), sleep = async () => {}, maxRescans = 3 }) {
  assert.ok(api && typeof api === "object", "authenticated GitHub API adapter is required");
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const report = buildCandidateReport(registries);
  const now = () => typeof observedAt === "function" ? observedAt() : observedAt;
  let lastObserved = -Infinity;
  const snapshot = async () => {
    const developRef = await api.get(`repos/${repository}/git/ref/heads/develop`);
    const refs = await api.get(`repos/${repository}/git/matching-refs/heads/feature/2.5.0-g01-`);
    const prPages = await api.paginate(`repos/${repository}/pulls`, { state: "all", per_page: 100 });
    const runPages = await api.paginate(`repos/${repository}/actions/workflows/ci.yml/runs`, { per_page: 100 });
    const artifactPages = await api.paginate(`repos/${repository}/actions/artifacts`, { per_page: 100 });
    const captured = now(), instant = Date.parse(captured);
    assert.ok(Number.isFinite(instant) && instant > lastObserved, "snapshot observedAt must be captured after pagination and increase across rescans");
    lastObserved = instant;
    return { repository, developRef, refs, prPages, runPages, artifactPages, paginationComplete: true, observedAt: captured };
  };
  let authority = await snapshot();
  let prepared = prepareBootstrapAuthority(report, authority);
  for (let scan = 0; scan < maxRescans && prepared.cleanupBranches.length; scan += 1) {
    const refsByBranch = new Map(authority.refs.map((ref) => [ref.ref.slice("refs/heads/".length), ref.object?.sha]));
    for (const branch of prepared.cleanupBranches) {
      const observedSha = refsByBranch.get(branch); assert.match(observedSha ?? "", SHA, "cleanup ref must have an observed SHA");
      await api.deleteRef(`heads/${branch}`, observedSha);
    }
    await sleep(scan + 1);
    authority = await snapshot();
    prepared = prepareBootstrapAuthority(report, authority);
  }
  validatePreparedRecord(prepared);
  const attemptsEntry = report.registries.find(({ name }) => name === "bootstrap-attempts.json");
  const recoveryEntry = report.registries.find(({ name }) => name === "bootstrap-landed-recoveries.json");
  const attempts = structuredClone(attemptsEntry.candidate), recoveries = structuredClone(recoveryEntry.candidate);
  if (prepared.attemptId.startsWith("g01-recovery-")) {
    assert.ok(priorFailure, "recovery branch creation requires authenticated landed failure authority");
    const priorId = priorFailure.evidenceId?.slice("bootstrap-failure.".length, -".json".length);
    assert.match(priorFailure.evidenceId ?? "", /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/); assert.match(priorFailure.digest ?? "", DIGEST);
    assert.equal(priorFailure.terminalDevelopSha, prepared.developSha, "recovery must prepare from the failed terminal develop SHA");
    assert.ok(Array.isArray(priorFailure.recoveryLineage), "recovery authority must carry complete lineage");
    priorFailure.recoveryLineage.forEach(validateRecovery);
    if (priorId.startsWith("g01-recovery-")) { assert.ok(priorFailure.recoveryLineage.length > 0); assert.equal(priorFailure.recoveryLineage.at(-1).attemptId, priorId, "recovery lineage must end at the failed recovery"); }
    else assert.equal(priorFailure.recoveryLineage.length, 0, "direct failure has no recovery ancestors");
    recoveries.landedAncestors = structuredClone(priorFailure.recoveryLineage);
  } else assert.equal(priorFailure, null, "direct preparation cannot carry landed recovery authority");
  attempts.state = recoveries.state = "G01_PRE_BRANCH";
  attempts.currentAttempt = null; recoveries.currentRecovery = null;
  attempts.preparedAuthority = structuredClone(prepared);
  attempts.ordinalReconstruction = { complete: false, nextOrdinal: null, reason: "prepared branch is provisional; first authenticated PR/run consumes the ordinal" };
  const files = new Map(registries.map(({ filename, bytes }) => [path.basename(filename), { filename, bytes }]));
  files.get(attemptsEntry.name).bytes = Buffer.from(`${JSON.stringify(attempts, null, 2)}\n`);
  files.get(recoveryEntry.name).bytes = Buffer.from(`${JSON.stringify(recoveries, null, 2)}\n`);
  const blobs = [];
  for (const { filename, bytes } of files.values()) blobs.push({ path: filename, mode: "100644", type: "blob", sha: (await api.createBlob({ content: Buffer.from(bytes).toString("base64"), encoding: "base64" })).sha });
  const baseCommit = await api.get(`repos/${repository}/git/commits/${prepared.developSha}`);
  const tree = await api.createTree({ base_tree: baseCommit.tree.sha, tree: blobs });
  const commit = await api.createCommit({ message: `ci(release): prepare ${prepared.attemptId}`, tree: tree.sha, parents: [prepared.developSha] });
  try { await api.createRef({ ref: `refs/heads/${prepared.branchName}`, sha: commit.sha }); }
  catch (error) { error.message = `atomic branch creation failed; ordinal was not consumed: ${error.message}`; throw error; }
  return { prepared, commit, tree, registries: { attempts, recoveries } };
}

function validatePreparedAuthority(prepared, authority, ordinal) {
  validatePreparedRecord(prepared);
  exactKeys(prepared, ["schemaVersion", "release", "status", "repository", "observedAt", "developSha", "nextOrdinal", "attemptId", "branchName", "cleanupBranches", "activeBranches", "conflicts", "authorityDigest", "replayRecord"], "prepared authority");
  assert.equal(prepared.schemaVersion, 1); assert.equal(prepared.release, "2.5.0"); assert.equal(prepared.status, "READY", "pre-branch preparation is not ready");
  assert.equal(prepared.repository, authority.repository); assert.equal(prepared.developSha, authority.pr.base.sha); assert.equal(prepared.nextOrdinal, ordinal);
  assert.equal(prepared.attemptId, authority.pr.head.ref === "feature/2.5.0-g01-canonical-evidence-bootstrap" ? `g01-a${ordinalId(ordinal)}` : `g01-recovery-a${ordinalId(ordinal)}`, "prepared attempt identity mismatch");
  assert.equal(prepared.branchName, authority.pr.head.ref, "CI branch is not the branch authorized before creation");
  assert.equal(prepared.authorityDigest, hashJson(prepared.replayRecord), "prepared authority digest must bind the full canonical replay record");
  assert.equal(prepared.replayRecord.observedMax + 1, ordinal); assert.deepEqual(prepared.activeBranches, []); assert.deepEqual(prepared.conflicts, []);
}

export function reconstructNextOrdinal(candidateReport, authority) {
  exactKeys(authority, ["repository", "pr", "currentRun", "headCommit", "prPages", "runPages", "artifactPages", "paginationComplete", "capture", "observedAt", "priorFailure", "preparedAuthority"], "bootstrap activation authority");
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
    prepared: authority.preparedAuthority ? { attemptId: authority.preparedAuthority.attemptId, observedAt: authority.preparedAuthority.observedAt, cleanupBranches: authority.preparedAuthority.cleanupBranches, activeBranches: authority.preparedAuthority.activeBranches, conflicts: authority.preparedAuthority.conflicts, queries: authority.preparedAuthority.replayRecord.queries, pages: authority.preparedAuthority.replayRecord.pages, reconstructionDigest: authority.preparedAuthority.replayRecord.reconstructionDigest, authorityDigest: authority.preparedAuthority.authorityDigest } : null,
  };
  capture.reconstructionDigest = captureDigest(capture);
  return capture;
}

function validateActivationCapture(authority) {
  exactKeys(authority.capture, ["queries", "responses", "pages", "pagination", "facts", "normalizedIdentities", "observedMax", "prepared", "reconstructionDigest"], "activation capture");
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
  if (authority.capture.prepared !== null) assert.deepEqual(authority.capture.prepared, { attemptId: authority.preparedAuthority.attemptId, observedAt: authority.preparedAuthority.observedAt, cleanupBranches: authority.preparedAuthority.cleanupBranches, activeBranches: authority.preparedAuthority.activeBranches, conflicts: authority.preparedAuthority.conflicts, queries: authority.preparedAuthority.replayRecord.queries, pages: authority.preparedAuthority.replayRecord.pages, reconstructionDigest: authority.preparedAuthority.replayRecord.reconstructionDigest, authorityDigest: authority.preparedAuthority.authorityDigest }, "activation capture must bind the full prepared replay");
  else assert.equal(authority.capture.prepared, null);
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
  assert.ok(["G01_PRE_BRANCH", "G01_PREMERGE_ACTIVE"].includes(attempts.state), "tracked direct registry must be prepared before activation");
  assert.ok(["G01_PRE_BRANCH", "G01_PREMERGE_ACTIVE"].includes(recoveries.state), "tracked recovery registry must be prepared before activation");
  const embedded = attempts.preparedAuthority;
  if (embedded) { assert.equal(attempts.state, "G01_PRE_BRANCH"); assert.equal(attempts.currentAttempt, null); authority.preparedAuthority = structuredClone(embedded); }
  else { assert.equal(attempts.currentAttempt, null); assert.equal(recoveries.currentRecovery, null); }
  if (embedded) validateActivationCapture(authority);
  const ordinal = embedded ? embedded.nextOrdinal : reconstructNextOrdinal(candidateReport, authority); const suffix = ordinalId(ordinal);
  validatePreparedAuthority(authority.preparedAuthority, authority, ordinal);
  const authorityDigest = authority.preparedAuthority.authorityDigest;
  const planSpecPairDigest = `sha256:${crypto.createHash("sha256").update(Buffer.concat([Buffer.from(String(planBytes.length)), Buffer.from(":"), planBytes, Buffer.from(String(specBytes.length)), Buffer.from(":"), specBytes])).digest("hex")}`;
  const common = { baseSha: authority.pr.base.sha, parentSha: authority.headCommit.parents[0].sha, headSha: authority.pr.head.sha, authorityDigest, planSpecPairDigest, firstAuthoritativeId: `pr:${authority.pr.node_id}:run:${authority.currentRun.id}:attempt:${authority.currentRun.run_attempt}` };
  if (authority.pr.head.ref === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    const attemptId = `g01-a${suffix}`;
    assert.equal(attempts.attempts.some((entry) => entry.ordinal === ordinal || entry.attemptId === attemptId), false, "reconstructed direct ordinal is already consumed"); attempts.attempts.push({ attemptId, ordinal, branch: authority.pr.head.ref, ...common });
    attempts.currentAttempt = attemptId; delete attempts.preparedAuthority;
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
  activated.activationAuthority = { preparedAuthority: structuredClone(authority.preparedAuthority), activationCapture: structuredClone(authority.capture) };
  return { report: activated, identity: activeIdentity(activated, authority.pr.head.sha, authority.pr.head.ref), ordinal };
}

function activeIdentity(candidateReport, sourceSha, sourceBranch) {
  exactKeys(candidateReport.activationAuthority, ["preparedAuthority", "activationCapture"], "candidate activation authority");
  const prepared = candidateReport.activationAuthority.preparedAuthority;
  assert.equal(prepared.authorityDigest, hashJson(prepared.replayRecord), "candidate preparation replay digest mismatch");
  const named = new Map(candidateReport.registries.map(({ name, candidate }) => [name, candidate]));
  if (sourceBranch === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    const registry = named.get("bootstrap-attempts.json");
    assert.equal(registry?.state, "G01_PREMERGE_ACTIVE", "direct F7 requires an active reconstructed attempt");
    const matches = registry.attempts.filter(({ attemptId }) => attemptId === registry.currentAttempt);
    assert.equal(matches.length, 1, "direct current attempt must resolve exactly once");
    const current = matches[0];
    assert.equal(current.authorityDigest, prepared.authorityDigest, "direct attempt is not bound to its prepared replay");
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
  assert.equal(current.authorityDigest, prepared.authorityDigest, "recovery attempt is not bound to its prepared replay");
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


function githubCliAdapter(repository) {
  const call = (args, input) => { const result = spawnSync("gh", ["api", ...args], { encoding: "utf8", input }); if (result.status !== 0) throw new Error(result.stderr.trim() || `gh api failed (${result.status})`); return result.stdout.trim() ? JSON.parse(result.stdout) : null; };
  return {
    get: (endpoint) => call([endpoint]),
    paginate: (endpoint, variables) => { const fields = Object.entries(variables).flatMap(([key, value]) => ["-f", `${key}=${value}`]); return call(["--method", "GET", "--paginate", "--slurp", endpoint, ...fields]); },
    deleteRef: (ref, observedSha) => {
      const fullRef = `refs/${ref}`;
      const result = spawnSync("git", ["push", `--force-with-lease=${fullRef}:${observedSha}`, "origin", `:${fullRef}`], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(`cleanup ref changed or was recreated; WAITING: ${result.stderr || result.stdout}`);
      return { deleted: fullRef, observedSha };
    },
    createBlob: (body) => call(["--method", "POST", `repos/${repository}/git/blobs`, "--input", "-"], JSON.stringify(body)),
    createTree: (body) => call(["--method", "POST", `repos/${repository}/git/trees`, "--input", "-"], JSON.stringify(body)),
    createCommit: (body) => call(["--method", "POST", `repos/${repository}/git/commits`, "--input", "-"], JSON.stringify(body)),
    createRef: (body) => call(["--method", "POST", `repos/${repository}/git/refs`, "--input", "-"], JSON.stringify(body)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const f7 = args.includes("--f7");
  const prepareLive = args.includes("--prepare-live");
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
    return args[index + 1];
  };
  const activationPath = args.includes("--activate-authority") ? option("--activate-authority") : undefined;
  const preparePath = args.includes("--prepare") ? option("--prepare") : undefined;
  const optionNames = ["--source-sha", "--source-branch", "--created-at", "--activate-authority", "--prepare", "--plan", "--spec", "--repository", "--observed-at", "--prior-failure"];
  const excluded = new Set(["--f7", "--prepare-live", ...optionNames, ...optionNames.filter((name) => args.includes(name)).map(option)]);
  const files = args.filter((value) => !excluded.has(value));
  if (files.length === 0) throw new Error("usage: bootstrap-export.mjs REGISTRY.json [REGISTRY.json]");
  if (prepareLive) { const repository = option("--repository"); const result = await prepareAndCreateBootstrapBranch({ api: githubCliAdapter(repository), repository, registries: files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })), planBytes: fs.readFileSync(option("--plan")), specBytes: fs.readFileSync(option("--spec")), priorFailure: args.includes("--prior-failure") ? JSON.parse(fs.readFileSync(option("--prior-failure"))) : null, observedAt: args.includes("--observed-at") ? option("--observed-at") : () => new Date().toISOString() }); process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(0); }
  let report = buildCandidateReport(files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })));
  if (activationPath) report = activateCandidateReport(report, JSON.parse(fs.readFileSync(activationPath, "utf8")), fs.readFileSync(option("--plan")), fs.readFileSync(option("--spec"))).report;
  const output = preparePath ? prepareBootstrapAuthority(report, JSON.parse(fs.readFileSync(preparePath, "utf8"))) : f7 ? buildF7Envelope(report, option("--source-sha"), option("--source-branch"), option("--created-at")) : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
