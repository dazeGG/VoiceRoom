#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { validateEnvelope } from "./validate-envelope.mjs";
import { G01_WRITABLE } from "./recover-landed-bootstrap.mjs";
import { selectCanonicalFailure, validateBootstrapFailure } from "./emit-bootstrap-selection.mjs";

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

function canonicalHistoricalIdentities(authority, { preBranch = false, unreconciled = [] } = {}) {
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
      unreconciled.push({ prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id, branch, headSha: pr.head.sha, state: pr.state, mergedAt: pr.merged_at ?? null });
      continue;
    }
    if (authenticated.length === 0 && (authority.abandonmentAuthorities ?? []).some((item) => item.record?.prId === pr.id && item.record?.headSha === pr.head.sha)) continue;
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
  for (const abandonment of authority.abandonmentAuthorities ?? []) {
    validateAbandonmentAuthority(authority.repository, abandonment);
    const pr = prs.find((item) => item.id === abandonment.record.prId && item.number === abandonment.record.prNumber && item.node_id === abandonment.record.prNodeId);
    assert.ok(pr && pr.state === "closed" && !pr.merged_at, "abandonment authority must bind a closed-unmerged canonical PR");
    assert.equal(pr.head.ref, abandonment.record.branch); assert.equal(pr.head.sha, abandonment.record.headSha);
    const ordinal = Number(abandonment.record.attemptId.match(/[0-9]+$/)[0]);
    if (!rows.some((row) => row.ordinal === ordinal && row.headSha === pr.head.sha)) rows.push({ ordinal, attemptId: abandonment.record.attemptId, prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id, branch: pr.head.ref, headSha: pr.head.sha, abandonmentStatusId: abandonment.status.id });
    const index = unreconciled.findIndex((item) => item.prId === pr.id && item.headSha === pr.head.sha); if (index >= 0) unreconciled.splice(index, 1);
  }
  return rows.sort((a, b) => a.ordinal - b.ordinal || a.runId - b.runId || a.artifactId - b.artifactId);
}

function ordinalId(ordinal) { return String(ordinal).padStart(2, "0"); }

function hashJson(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

function abandonmentCore(repository, pr, attemptId) {
  return { schemaVersion: 1, state: "ABANDONED_PREMERGE", repository, attemptId, branch: pr.head.ref, headSha: pr.head.sha, prId: pr.id, prNumber: pr.number, prNodeId: pr.node_id };
}

function validateAbandonmentAuthority(repository, authority) {
  exactKeys(authority, ["record", "digest", "status"], "abandonment authority");
  exactKeys(authority.record, ["schemaVersion", "state", "repository", "attemptId", "branch", "headSha", "prId", "prNumber", "prNodeId"], "abandonment record");
  assert.equal(authority.record.schemaVersion, 1); assert.equal(authority.record.state, "ABANDONED_PREMERGE"); assert.equal(authority.record.repository, repository);
  assert.match(authority.record.attemptId, /^g01-(?:recovery-)?a[0-9]{2,}$/); assert.match(authority.record.headSha, SHA); assert.match(authority.digest, DIGEST);
  assert.equal(authority.digest, hashJson(authority.record), "abandonment record digest mismatch");
  assert.ok(Number.isInteger(authority.status?.id) && authority.status.id > 0, "immutable abandonment status ID is required");
  assert.equal(authority.status.headSha, authority.record.headSha); assert.equal(authority.status.state, "error");
  assert.equal(authority.status.context, `g01/ABANDONED_PREMERGE/${authority.record.attemptId}`);
  assert.equal(authority.status.description, `ABANDONED_PREMERGE ${authority.digest}`);
  return authority;
}

function abandonmentAttemptId(pr, observedMax) {
  const recovery = pr.head?.ref?.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/)?.[1];
  return recovery ? `g01-recovery-a${recovery}` : `g01-a${ordinalId(observedMax + 1)}`;
}

function artifactOrdinalsFromPages(pages) {
  return [...new Set(pages.flatMap((page) => page.artifacts ?? []).flatMap((artifact) => {
    const match = artifact.name?.match(/^g01-(?:candidate|approval|merge|bootstrap-failure|selection|bootstrap-preparation)-(?:g01-)?(?:recovery-)?a([0-9]{2,})-/);
    return match ? [Number(match[1])] : [];
  }))];
}

export function prepareBootstrapAuthority(candidateReport, authority) {
  exactKeys(authority, ["repository", "developRef", "refs", "prPages", "runPages", "artifactPages", "abandonmentAuthorities", "paginationComplete", "observedAt"], "pre-branch authority");
  assert.equal(authority.paginationComplete, true, "pre-branch preparation requires complete pagination");
  assert.match(authority.developRef?.object?.sha ?? "", SHA, "pre-branch develop ref is required");
  const observed = Date.parse(authority.observedAt);
  assert.ok(Number.isFinite(observed) && new Date(observed).toISOString() === authority.observedAt, "pre-branch observation must be canonical UTC");
  const unreconciled = [];
  const normalizedIdentities = canonicalHistoricalIdentities(authority, { preBranch: true, unreconciled });
  const tracked = candidateReport.registries.flatMap(({ candidate }) => [...(candidate.attempts ?? []), ...(candidate.landedAncestors ?? [])]).map((item) => Number(item.attemptId.match(/[0-9]+$/)?.[0])).filter(Number.isInteger);
  const artifactOrdinals = artifactOrdinalsFromPages(authority.artifactPages);
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
  const abandonmentAuthorities = structuredClone(authority.abandonmentAuthorities ?? []);
  abandonmentAuthorities.forEach((item) => validateAbandonmentAuthority(authority.repository, item));
  normalizedIdentities.sort((a, b) => a.ordinal - b.ordinal || (a.runId ?? 0) - (b.runId ?? 0) || (a.artifactId ?? 0) - (b.artifactId ?? 0));
  const finalObservedMax = Math.max(observedMax, ...abandonmentAuthorities.map((item) => Number(item.record.attemptId.match(/[0-9]+$/)[0])));
  const nextOrdinal = finalObservedMax + 1;
  const suffix = ordinalId(nextOrdinal);
  const recoveryRequired = authority.artifactPages.flatMap((page) => page.artifacts ?? []).some((artifact) => {
    const match = artifact.name?.match(/^g01-bootstrap-failure-g01-(?:recovery-)?a([0-9]{2,})-run-[0-9]+-attempt-[0-9]+-head-([0-9a-f]{40})-phase-(?:f11|selection)$/);
    return match && Number(match[1]) === finalObservedMax && match[2] === authority.developRef.object.sha && artifact.expired !== true;
  });
  const illegalDirect = recoveryRequired && refBranches.includes("feature/2.5.0-g01-canonical-evidence-bootstrap");
  if (illegalDirect) conflicts.push(1);
  const attemptId = recoveryRequired ? `g01-recovery-a${suffix}` : `g01-a${suffix}`;
  const branchName = recoveryRequired ? `feature/2.5.0-g01-postmerge-bootstrap-a${suffix}` : "feature/2.5.0-g01-canonical-evidence-bootstrap";
  const sortedArtifactOrdinals = [...artifactOrdinals].sort((a, b) => a - b), sortedTracked = [...tracked].sort((a, b) => a - b);
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
    unreconciled,
    expiredArtifactOrdinals: [...new Set(authority.artifactPages.flatMap((page) => page.artifacts ?? []).filter(({ expired }) => expired === true).flatMap((artifact) => artifact.name?.match(/a([0-9]{2,})/)?.[1] ? [Number(artifact.name.match(/a([0-9]{2,})/)[1])] : []))].sort((a, b) => a - b),
    abandonmentAuthorities,
    artifactOrdinals: sortedArtifactOrdinals,
    trackedOrdinals: sortedTracked,
    observedMax: finalObservedMax,
    reconstructionDigest: hashJson({ normalizedIdentities, artifactOrdinals: sortedArtifactOrdinals, tracked: sortedTracked, abandonmentAuthorities, observedMax: finalObservedMax }),
  };
  const authorityDigest = hashJson(replayRecord);
  const status = conflicts.length ? "WAITING_CONFLICT" : activeBranches.length ? "WAITING_ACTIVE_BRANCH" : unreconciled.length ? "WAITING_UNRECONCILED" : "READY";
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

function candidateTreeManifest(candidateFiles) {
  assert.ok(Array.isArray(candidateFiles), "complete reviewed G01 candidate file map is required");
  const names = candidateFiles.map(({ filename }) => filename);
  assert.equal(new Set(names).size, names.length, "candidate file map contains duplicate paths");
  assert.deepEqual([...names].sort(), [...G01_WRITABLE].sort(), "candidate file map must equal the literal 36-path G01 allowlist");
  return candidateFiles.map(({ filename, bytes, mode }) => {
    assert.ok(Buffer.isBuffer(bytes), `candidate bytes are required: ${filename}`);
    assert.match(mode ?? "", /^100(?:644|755)$/, `candidate Git mode is required: ${filename}`);
    return { path: filename, mode, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveAuthenticatedPriorFailure(api, repository, prepared, artifactPages) {
  const ordinal = prepared.nextOrdinal - 1;
  assert.ok(ordinal >= 1, "recovery requires a prior consumed ordinal");
  const suffix = ordinalId(ordinal);
  const pattern = new RegExp(`^g01-bootstrap-failure-(g01-(?:recovery-)?a${suffix})-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)-head-${prepared.developSha}-phase-(f11|selection)$`);
  const candidates = artifactPages.flatMap((page) => page.artifacts ?? []).filter((artifact) => !artifact.expired && pattern.test(artifact.name ?? ""));
  assert.ok(candidates.length > 0, "WAITING: live authenticated prior failure artifact is absent");
  const records = [];
  for (const candidate of candidates) {
    const metadata = await api.get(`repos/${repository}/actions/artifacts/${candidate.id}`);
    const match = metadata.name?.match(pattern);
    assert.ok(match && metadata.id === candidate.id && metadata.workflow_run?.id === Number(match[2]), "prior failure artifact metadata mismatch");
    assert.match(metadata.digest ?? "", DIGEST, "prior failure artifact digest is required");
    const run = await api.get(`repos/${repository}/actions/runs/${metadata.workflow_run.id}`);
    assert.equal(run.id, Number(match[2])); assert.equal(run.run_attempt, Number(match[3]));
    assert.equal(run.name, "CI/CD"); assert.equal(run.path, ".github/workflows/ci.yml"); assert.equal(run.repository?.full_name, repository);
    assert.equal(run.event, "push"); assert.equal(run.head_branch, "develop"); assert.equal(run.head_sha, prepared.developSha); assert.equal(run.status, "completed"); assert.ok(run.conclusion && run.conclusion !== "success");
    const archive = await api.readArtifact(metadata);
    assert.ok(Buffer.isBuffer(archive.archiveBytes), "prior failure archive bytes are required");
    const archiveDigest = `sha256:${crypto.createHash("sha256").update(archive.archiveBytes).digest("hex")}`;
    assert.equal(archiveDigest, metadata.digest, "prior failure archive digest mismatch");
    const entries = Object.entries(archive.files ?? {}).filter(([name]) => /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/.test(path.basename(name)));
    assert.equal(entries.length, 1, "prior failure archive must contain exactly one failure payload");
    const bytes = Buffer.from(entries[0][1]);
    const failure = validateBootstrapFailure(JSON.parse(bytes));
    assert.equal(path.basename(entries[0][0]), failure.evidenceId, "prior failure archive payload name mismatch");
    records.push({ failure, artifactId: metadata.id, artifactName: metadata.name, artifactCreatedAt: metadata.created_at, archiveDigest, payloadDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, run });
  }
  const winner = selectCanonicalFailure(records, ordinal, prepared.developSha, repository);
  return {
    evidenceId: winner.failure.evidenceId,
    digest: winner.payloadDigest,
    artifactId: winner.artifactId,
    artifactName: winner.artifactName,
    artifactCreatedAt: winner.artifactCreatedAt,
    archiveDigest: winner.archiveDigest,
    runId: winner.run.id,
    runAttempt: winner.run.run_attempt,
    workflowName: winner.run.name,
    workflowPath: winner.run.path,
    repository: winner.run.repository.full_name,
    event: winner.run.event,
    headBranch: winner.run.head_branch,
    headSha: winner.run.head_sha,
    status: winner.run.status,
    conclusion: winner.run.conclusion,
    terminalDevelopSha: winner.failure.terminalDevelopSha,
    payload: structuredClone(winner.failure),
    recoveryLineage: structuredClone(winner.failure.recoveryLineage),
  };
}

function validatePriorFailureAuthority(value, repository) {
  exactKeys(value, ["evidenceId", "digest", "artifactId", "artifactName", "artifactCreatedAt", "archiveDigest", "runId", "runAttempt", "workflowName", "workflowPath", "repository", "event", "headBranch", "headSha", "status", "conclusion", "terminalDevelopSha", "payload", "recoveryLineage"], "prior failure authority");
  const payload = validateBootstrapFailure(value.payload);
  assert.equal(value.evidenceId, payload.evidenceId);
  assert.match(value.digest, DIGEST); assert.match(value.archiveDigest, DIGEST); assert.ok(Number.isInteger(value.artifactId) && value.artifactId > 0);
  assert.equal(value.runId, payload.runId); assert.equal(value.runAttempt, payload.runAttempt); assert.equal(value.workflowName, "CI/CD"); assert.equal(value.workflowPath, ".github/workflows/ci.yml");
  assert.equal(value.repository, repository); assert.equal(value.event, "push"); assert.equal(value.headBranch, "develop"); assert.equal(value.headSha, payload.terminalDevelopSha); assert.equal(value.terminalDevelopSha, payload.terminalDevelopSha);
  assert.equal(value.status, "completed"); assert.ok(value.conclusion && value.conclusion !== "success"); assert.deepEqual(value.recoveryLineage, payload.recoveryLineage);
  return value;
}

export async function prepareAndCreateBootstrapBranch({ api, repository, registries, candidateFiles, reviewedBaseSha, reviewedHeadSha, observedAt = () => new Date().toISOString(), sleep = async () => {}, maxRescans = 3 }) {
  assert.ok(api && typeof api === "object", "authenticated GitHub API adapter is required");
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(reviewedBaseSha ?? "", SHA, "reviewed develop base SHA is required");
  assert.match(reviewedHeadSha ?? "", SHA, "reviewed candidate HEAD SHA is required");
  const manifest = candidateTreeManifest(candidateFiles);
  const reviewedByPath = new Map(candidateFiles.map(({ filename, bytes }) => [filename, bytes]));
  for (const { filename, bytes } of registries) {
    const canonicalPath = `docs/releases/2.5.0/evidence/${path.basename(filename)}`;
    assert.ok(reviewedByPath.has(canonicalPath), `reviewed candidate is missing registry bytes: ${canonicalPath}`);
    assert.ok(Buffer.from(bytes).equals(reviewedByPath.get(canonicalPath)), `registry input differs from reviewed candidate bytes: ${canonicalPath}`);
  }
  const report = buildCandidateReport(registries);
  const now = () => typeof observedAt === "function" ? observedAt() : observedAt;
  let lastObserved = -Infinity;
  const snapshot = async () => {
    const developRef = await api.get(`repos/${repository}/git/ref/heads/develop`);
    const refs = await api.get(`repos/${repository}/git/matching-refs/heads/feature/2.5.0-g01-`);
    const prPages = await api.paginate(`repos/${repository}/pulls`, { state: "all", per_page: 100 });
    const runPages = await api.paginate(`repos/${repository}/actions/workflows/ci.yml/runs`, { per_page: 100 });
    const artifactPages = await api.paginate(`repos/${repository}/actions/artifacts`, { per_page: 100 });
    const abandonmentAuthorities = [];
    if (typeof api.listCommitStatuses === "function") {
      const canonicalPrs = prPages.flatMap((page) => Array.isArray(page) ? page : []).filter((pr) => pr.state === "closed" && !pr.merged_at && /^feature\/2\.5\.0-g01-(?:canonical-evidence-bootstrap|postmerge-bootstrap-a[0-9]{2,})$/.test(pr.head?.ref ?? ""));
      for (const pr of canonicalPrs) {
        const statuses = await api.listCommitStatuses(pr.head.sha);
        for (const status of statuses) {
          const attemptId = status.context?.match(/^g01\/ABANDONED_PREMERGE\/(g01-(?:recovery-)?a[0-9]{2,})$/)?.[1];
          if (!attemptId) continue;
          const record = abandonmentCore(repository, pr, attemptId), digest = hashJson(record);
          if (status.description === `ABANDONED_PREMERGE ${digest}`) abandonmentAuthorities.push({ record, digest, status: { ...status, headSha: pr.head.sha } });
        }
      }
    }
    const captured = now(), instant = Date.parse(captured);
    assert.ok(Number.isFinite(instant) && instant > lastObserved, "snapshot observedAt must be captured after pagination and increase across rescans");
    lastObserved = instant;
    return { repository, developRef, refs, prPages, runPages, artifactPages, abandonmentAuthorities, paginationComplete: true, observedAt: captured };
  };
  let authority = await snapshot();
  let prepared = prepareBootstrapAuthority(report, authority);
  const cleanupAudit = [];
  for (let scan = 0; scan < maxRescans && prepared.cleanupBranches.length; scan += 1) {
    const closedPrs = authority.prPages.flatMap((page) => Array.isArray(page) ? page : []).filter((pr) => pr.state === "closed" && !pr.merged_at);
    let ordinal = prepared.replayRecord.observedMax;
    for (const branch of prepared.cleanupBranches) {
      const pr = closedPrs.find((item) => item.head?.ref === branch);
      if (!pr || authority.abandonmentAuthorities.some((item) => item.record.prId === pr.id && item.record.headSha === pr.head.sha)) continue;
      assert.equal(typeof api.createCommitStatus, "function", "ABANDONED_PREMERGE authority writer is required before cleanup");
      const attemptId = branch.includes("postmerge-bootstrap-a") ? abandonmentAttemptId(pr, ordinal) : abandonmentAttemptId(pr, ordinal++);
      const record = abandonmentCore(repository, pr, attemptId), digest = hashJson(record);
      const created = await api.createCommitStatus(pr.head.sha, { state: "error", context: `g01/ABANDONED_PREMERGE/${attemptId}`, description: `ABANDONED_PREMERGE ${digest}`, target_url: pr.html_url });
      assert.ok(Number.isInteger(created?.id) && created.id > 0, "ABANDONED_PREMERGE status creation must return an immutable ID");
      const reread = await api.listCommitStatuses(pr.head.sha);
      const persistedRaw = reread.find((status) => status.id === created.id);
      const persisted = persistedRaw && { ...persistedRaw, headSha: pr.head.sha };
      assert.ok(persisted, "ABANDONED_PREMERGE status must be re-read before cleanup");
      validateAbandonmentAuthority(repository, { record, digest, status: persisted });
    }
    authority = await snapshot();
    prepared = prepareBootstrapAuthority(report, authority);
    assert.equal(prepared.replayRecord.unreconciled.length, 0, "ABANDONED_PREMERGE authority must reconcile every cleanup PR before ref deletion");
    const preSnapshot = { observedAt: authority.observedAt, refsDigest: hashJson(authority.refs), authorityDigest: prepared.authorityDigest };
    const refsByBranch = new Map(authority.refs.map((ref) => [ref.ref.slice("refs/heads/".length), ref.object?.sha]));
    for (const branch of prepared.cleanupBranches) {
      const observedSha = refsByBranch.get(branch); assert.match(observedSha ?? "", SHA, "cleanup ref must have an observed SHA");
      const deletedAt = now();
      const result = await api.deleteRef(`heads/${branch}`, observedSha);
      assert.ok(result && typeof result === "object", "cleanup compare-delete result must be persisted");
      cleanupAudit.push({ branch, ref: `refs/heads/${branch}`, observedSha, preSnapshot, deleteResult: result ?? null, deletedAt, postRescan: null });
    }
    await sleep(scan + 1);
    authority = await snapshot();
    prepared = prepareBootstrapAuthority(report, authority);
    const postRescan = { observedAt: authority.observedAt, refsDigest: hashJson(authority.refs), authorityDigest: prepared.authorityDigest };
    for (const entry of cleanupAudit.filter((entry) => entry.postRescan === null)) entry.postRescan = postRescan;
  }
  assert.equal(prepared.developSha, reviewedBaseSha, "reviewed candidate base is not the exact live develop SHA");
  prepared.replayRecord.cleanupAudit = cleanupAudit;
  prepared.replayRecord.candidateTree = { reviewedBaseSha, reviewedHeadSha, paths: manifest, treeDigest: hashJson(manifest) };
  prepared.authorityDigest = hashJson(prepared.replayRecord);
  validatePreparedRecord(prepared);
  const attemptsEntry = report.registries.find(({ name }) => name === "bootstrap-attempts.json");
  const recoveryEntry = report.registries.find(({ name }) => name === "bootstrap-landed-recoveries.json");
  const attempts = structuredClone(attemptsEntry.candidate), recoveries = structuredClone(recoveryEntry.candidate);
  if (prepared.attemptId.startsWith("g01-recovery-")) {
    const priorFailure = await resolveAuthenticatedPriorFailure(api, repository, prepared, authority.artifactPages);
    validatePriorFailureAuthority(priorFailure, repository);
    prepared.replayRecord.priorFailureAuthority = structuredClone(priorFailure);
    prepared.authorityDigest = hashJson(prepared.replayRecord);
    const priorId = priorFailure.evidenceId?.slice("bootstrap-failure.".length, -".json".length);
    assert.match(priorFailure.evidenceId ?? "", /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/); assert.match(priorFailure.digest ?? "", DIGEST);
    assert.equal(priorFailure.terminalDevelopSha, prepared.developSha, "recovery must prepare from the failed terminal develop SHA");
    assert.ok(Array.isArray(priorFailure.recoveryLineage), "recovery authority must carry complete lineage");
    priorFailure.recoveryLineage.forEach(validateRecovery);
    if (priorId.startsWith("g01-recovery-")) { assert.ok(priorFailure.recoveryLineage.length > 0); assert.equal(priorFailure.recoveryLineage.at(-1).attemptId, priorId, "recovery lineage must end at the failed recovery"); }
    else assert.equal(priorFailure.recoveryLineage.length, 0, "direct failure has no recovery ancestors");
    recoveries.landedAncestors = structuredClone(priorFailure.recoveryLineage);
  }
  attempts.state = recoveries.state = "G01_PRE_BRANCH";
  attempts.currentAttempt = null; recoveries.currentRecovery = null;
  attempts.preparedAuthority = structuredClone(prepared);
  attempts.ordinalReconstruction = { complete: false, nextOrdinal: null, reason: "prepared branch is provisional; first authenticated PR/run consumes the ordinal" };
  const files = new Map(candidateFiles.map(({ filename, bytes }) => [filename, { filename, bytes }]));
  files.get("docs/releases/2.5.0/evidence/bootstrap-attempts.json").bytes = Buffer.from(`${JSON.stringify(attempts, null, 2)}\n`);
  files.get("docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json").bytes = Buffer.from(`${JSON.stringify(recoveries, null, 2)}\n`);
  const blobs = [];
  const publishedFiles = [];
  const modeByPath = new Map(manifest.map(({ path: filename, mode }) => [filename, mode]));
  for (const { filename, bytes } of files.values()) {
    const blob = await api.createBlob({ content: Buffer.from(bytes).toString("base64"), encoding: "base64" });
    const mode = modeByPath.get(filename);
    blobs.push({ path: filename, mode, type: "blob", sha: blob.sha });
    publishedFiles.push({ path: filename, mode, blobSha: blob.sha, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length });
  }
  const baseCommit = await api.get(`repos/${repository}/git/commits/${prepared.developSha}`);
  const tree = await api.createTree({ base_tree: baseCommit.tree.sha, tree: blobs });
  const commit = await api.createCommit({ message: `ci(release): prepare ${prepared.attemptId}`, tree: tree.sha, parents: [prepared.developSha] });
  try { await api.createRef({ ref: `refs/heads/${prepared.branchName}`, sha: commit.sha }); }
  catch (error) { error.message = `atomic branch creation failed; ordinal was not consumed: ${error.message}`; throw error; }
  const publicationAuthority = { preparedAuthorityDigest: prepared.authorityDigest, reviewedBaseSha, reviewedHeadSha, baseTreeSha: baseCommit.tree.sha, publishedTreeSha: tree.sha, commitSha: commit.sha, files: publishedFiles.sort((a, b) => a.path.localeCompare(b.path)) };
  publicationAuthority.digest = hashJson(publicationAuthority);
  assert.equal(typeof api.createCommitStatus, "function", "immutable publication status writer is required");
  const createdPublicationStatus = await api.createCommitStatus(commit.sha, { state: "success", context: `g01/PUBLICATION/${prepared.attemptId}`, description: `G01_PUBLICATION ${publicationAuthority.digest}` });
  const publicationStatusRaw = (await api.listCommitStatuses(commit.sha)).find((status) => status.id === createdPublicationStatus.id);
  const publicationStatus = publicationStatusRaw && { ...publicationStatusRaw, headSha: commit.sha };
  assert.ok(publicationStatus, "immutable publication status must be re-read before preparation completes");
  assert.equal(publicationStatus.headSha, commit.sha); assert.equal(publicationStatus.context, `g01/PUBLICATION/${prepared.attemptId}`); assert.equal(publicationStatus.description, `G01_PUBLICATION ${publicationAuthority.digest}`);
  publicationAuthority.status = publicationStatus;
  return { prepared, publicationAuthority, commit, tree, registries: { attempts, recoveries } };
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
  exactKeys(authority, ["repository", "pr", "currentRun", "headCommit", "baseCommit", "headTree", "baseTree", "headBlobs", "publicationStatus", "abandonmentAuthorities", "prPages", "runPages", "artifactPages", "paginationComplete", "capture", "observedAt", "priorFailure", "preparedAuthority"], "bootstrap activation authority");
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
      baseCommit: { endpoint: `repos/${authority.repository}/commits/${authority.pr.base.sha}`, variables: { sha: authority.pr.base.sha } },
      headTree: { endpoint: `repos/${authority.repository}/git/trees/${authority.headCommit.commit.tree.sha}`, variables: { recursive: 1 } },
      baseTree: { endpoint: `repos/${authority.repository}/git/trees/${authority.baseCommit.commit.tree.sha}`, variables: { recursive: 1 } },
      prs: { endpoint: `repos/${authority.repository}/pulls`, variables: { state: "all", per_page: 100 } },
      runs: { endpoint: `repos/${authority.repository}/actions/workflows/ci.yml/runs`, variables: { per_page: 100 } },
      artifacts: { endpoint: `repos/${authority.repository}/actions/artifacts`, variables: { per_page: 100 } },
    },
    responses: { pr: hash(authority.pr), currentRun: hash(authority.currentRun), headCommit: hash(authority.headCommit), baseCommit: hash(authority.baseCommit), headTree: hash(authority.headTree), baseTree: hash(authority.baseTree), headBlobs: hash(authority.headBlobs), abandonmentAuthorities: hash(authority.abandonmentAuthorities ?? []) },
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
  exactKeys(authority.capture.queries, ["pr", "currentRun", "headCommit", "baseCommit", "headTree", "baseTree", "prs", "runs", "artifacts"], "activation queries");
  assert.deepEqual(authority.capture.queries, {
    pr: { endpoint: `repos/${authority.repository}/pulls/${authority.pr.number}`, variables: { prNumber: authority.pr.number } },
    currentRun: { endpoint: `repos/${authority.repository}/actions/runs/${authority.currentRun.id}`, variables: { runId: authority.currentRun.id } },
    headCommit: { endpoint: `repos/${authority.repository}/commits/${authority.pr.head.sha}`, variables: { sha: authority.pr.head.sha } },
    baseCommit: { endpoint: `repos/${authority.repository}/commits/${authority.pr.base.sha}`, variables: { sha: authority.pr.base.sha } },
    headTree: { endpoint: `repos/${authority.repository}/git/trees/${authority.headCommit.commit.tree.sha}`, variables: { recursive: 1 } },
    baseTree: { endpoint: `repos/${authority.repository}/git/trees/${authority.baseCommit.commit.tree.sha}`, variables: { recursive: 1 } },
    prs: { endpoint: `repos/${authority.repository}/pulls`, variables: { state: "all", per_page: 100 } },
    runs: { endpoint: `repos/${authority.repository}/actions/workflows/ci.yml/runs`, variables: { per_page: 100 } },
    artifacts: { endpoint: `repos/${authority.repository}/actions/artifacts`, variables: { per_page: 100 } },
  }, "activation query variables mismatch");
  exactKeys(authority.capture.responses, ["pr", "currentRun", "headCommit", "baseCommit", "headTree", "baseTree", "headBlobs", "abandonmentAuthorities"], "activation response hashes");
  exactKeys(authority.capture.pages, ["prs", "runs", "artifacts"], "activation page hashes");
  exactKeys(authority.capture.pagination, ["prs", "runs", "artifacts"], "activation pagination");
  exactKeys(authority.capture.facts, ["prNumber", "prId", "prNodeId", "runId", "runAttempt", "headSha", "headBranch"], "activation facts");
  for (const value of Object.values(authority.capture.responses)) assert.match(value, DIGEST);
  assert.equal(authority.capture.responses.pr, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.pr)).digest("hex")}`);
  assert.equal(authority.capture.responses.currentRun, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.currentRun)).digest("hex")}`);
  assert.equal(authority.capture.responses.headCommit, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.headCommit)).digest("hex")}`);
  assert.equal(authority.capture.responses.baseCommit, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.baseCommit)).digest("hex")}`);
  assert.equal(authority.capture.responses.headTree, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.headTree)).digest("hex")}`);
  assert.equal(authority.capture.responses.baseTree, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.baseTree)).digest("hex")}`);
  assert.equal(authority.capture.responses.headBlobs, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.headBlobs)).digest("hex")}`);
  assert.equal(authority.capture.responses.abandonmentAuthorities, `sha256:${crypto.createHash("sha256").update(JSON.stringify(authority.abandonmentAuthorities ?? [])).digest("hex")}`);
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

function validateLivePublication(authority, prepared) {
  assert.equal(authority.headTree?.truncated, false, "PR head recursive tree must be complete");
  assert.equal(authority.baseTree?.truncated, false, "develop base recursive tree must be complete");
  assert.match(authority.headTree?.sha ?? "", SHA); assert.match(authority.baseTree?.sha ?? "", SHA);
  assert.equal(authority.headCommit?.sha, authority.pr.head.sha, "authenticated head commit does not match PR head");
  assert.equal(authority.baseCommit?.sha, authority.pr.base.sha, "authenticated base commit does not match PR base");
  assert.equal(authority.headTree.sha, authority.headCommit?.commit?.tree?.sha, "PR head recursive tree SHA does not match the authenticated commit");
  assert.equal(authority.baseTree.sha, authority.baseCommit?.commit?.tree?.sha, "develop base recursive tree SHA does not match the authenticated commit");
  const toMap = (tree) => new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry]));
  const head = toMap(authority.headTree), base = toMap(authority.baseTree);
  const changed = [...new Set([...head.keys(), ...base.keys()])].filter((name) => head.get(name)?.sha !== base.get(name)?.sha || head.get(name)?.mode !== base.get(name)?.mode).sort();
  assert.deepEqual(changed, [...G01_WRITABLE].sort(), "PR publication delta must equal the literal 36-path G01 manifest");
  assert.ok(Array.isArray(authority.headBlobs) && authority.headBlobs.length === G01_WRITABLE.length, "all 36 PR head blobs must be fetched");
  const blobs = new Map(authority.headBlobs.map((item) => [item.path, item]));
  assert.equal(blobs.size, G01_WRITABLE.length, "PR head blob manifest contains duplicates");
  for (const manifest of prepared.replayRecord.candidateTree.paths) {
    const blob = blobs.get(manifest.path); assert.ok(blob, `missing fetched PR head blob: ${manifest.path}`);
    assert.equal(blob.sha, head.get(manifest.path)?.sha, `PR tree/blob SHA mismatch: ${manifest.path}`);
    assert.equal(head.get(manifest.path)?.mode, manifest.mode, `PR tree mode mismatch: ${manifest.path}`);
    assert.equal(blob.encoding, "base64", `PR blob encoding mismatch: ${manifest.path}`);
    const bytes = Buffer.from(blob.content, "base64");
    assert.equal(`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, blob.sha256, `PR blob digest mismatch: ${manifest.path}`);
    assert.equal(bytes.length, blob.size, `PR blob size mismatch: ${manifest.path}`);
  }
  const publicationAuthority = { preparedAuthorityDigest: prepared.authorityDigest, reviewedBaseSha: prepared.replayRecord.candidateTree.reviewedBaseSha, reviewedHeadSha: prepared.replayRecord.candidateTree.reviewedHeadSha, baseTreeSha: authority.baseTree.sha, publishedTreeSha: authority.headTree.sha, commitSha: authority.pr.head.sha, files: authority.headBlobs.map(({ path, sha, sha256, size }) => ({ path, mode: head.get(path)?.mode, blobSha: sha, sha256, size })).sort((a, b) => a.path.localeCompare(b.path)) };
  publicationAuthority.digest = hashJson(publicationAuthority);
  const status = authority.publicationStatus;
  assert.ok(Number.isInteger(status?.id) && status.id > 0, "immutable publication status ID is required"); assert.equal(status.headSha, authority.pr.head.sha); assert.equal(status.state, "success");
  assert.equal(status.context, `g01/PUBLICATION/${prepared.attemptId}`); assert.equal(status.description, `G01_PUBLICATION ${publicationAuthority.digest}`, "live publication authority digest mismatch");
}

export function activateCandidateReport(candidateReport, authority, planBytes, specBytes) {
  exactKeys(authority, ["repository", "pr", "currentRun", "headCommit", "baseCommit", "headTree", "baseTree", "headBlobs", "publicationStatus", "abandonmentAuthorities", "prPages", "runPages", "artifactPages", "paginationComplete", "capture", "observedAt", "priorFailure", "preparedAuthority"], "bootstrap activation authority");
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
  const liveIdentities = canonicalHistoricalIdentities(authority);
  const tracked = candidateReport.registries.flatMap(({ candidate }) => [...(candidate.attempts ?? []), ...(candidate.landedAncestors ?? [])]).map((item) => Number(item.attemptId.match(/[0-9]+$/)?.[0])).filter(Number.isInteger);
  const liveObservedMax = Math.max(0, ...tracked, ...liveIdentities.map(({ ordinal: value }) => value));
  assert.deepEqual(authority.preparedAuthority.replayRecord.normalizedIdentities, liveIdentities, "prepared normalized history differs from live activation history");
  assert.equal(authority.preparedAuthority.replayRecord.observedMax, liveObservedMax, "prepared observed maximum differs from live activation history");
  assert.deepEqual(authority.preparedAuthority.replayRecord.trackedOrdinals, [...tracked].sort((a, b) => a - b), "prepared tracked ordinals differ from live registries");
  const liveArtifactOrdinals = artifactOrdinalsFromPages(authority.artifactPages).sort((a, b) => a - b);
  assert.deepEqual(authority.preparedAuthority.replayRecord.artifactOrdinals, liveArtifactOrdinals, "prepared artifact ordinals differ from live activation history");
  assert.deepEqual(authority.preparedAuthority.replayRecord.abandonmentAuthorities, authority.abandonmentAuthorities ?? [], "prepared abandonment authorities differ from live immutable statuses");
  const liveReconstruction = hashJson({ normalizedIdentities: liveIdentities, artifactOrdinals: liveArtifactOrdinals, tracked: [...tracked].sort((a, b) => a - b), abandonmentAuthorities: authority.abandonmentAuthorities ?? [], observedMax: liveObservedMax });
  assert.equal(authority.preparedAuthority.replayRecord.reconstructionDigest, liveReconstruction, "prepared reconstruction differs from live activation pages");
  validateLivePublication(authority, authority.preparedAuthority);
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
    validatePriorFailureAuthority(authority.priorFailure, authority.repository);
    assert.deepEqual(authority.priorFailure, authority.preparedAuthority.replayRecord.priorFailureAuthority, "activation must use the exact prior-failure authority frozen during live preparation");
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

const F7_REQUIRED_GATES = ["Git Flow policy", "Lint, typecheck & build", "Tests", "G01 targeted bootstrap gate"];
const F7_FIXTURES = ["scripts/test/fixtures/g01-landed-bootstrap-recovery.json"];
const F7_INPUT_PATHS = [".github/workflows/ci.yml", "config/evidence/release-evidence-archive.v1.json", "docs/RELEASE_2.5.0_PLAN.md", "docs/RELEASE_2.5.0_TEST_SPEC.md", "docs/releases/2.5.0/evidence/schema/envelope.schema.json"];

function canonicalInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  const time = Date.parse(value); assert.ok(Number.isFinite(time), `${label} must be an ISO timestamp`); return time;
}
function authenticatedGitHubInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  assert.match(value, /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i, `${label} must include a timezone`);
  return canonicalInstant(value, label);
}
function fileRecord(path, bytes) {
  const body = Buffer.from(bytes); return { path, size: body.length, sha256: `sha256:${crypto.createHash("sha256").update(body).digest("hex")}` };
}

export function buildG01VerificationCatalog(planBytes, specBytes, inputFiles, reportFiles, manifest, producerGate) {
  const plan = Buffer.from(planBytes).toString("utf8");
  const section = plan.match(/### G01 — canonical unified plan[\s\S]*?(?=\n### G02 —)/)?.[0]; assert.ok(section, "G01 plan card is absent");
  const targeted = section.match(/^- \*\*Targeted verification:\*\* (.+)$/m)?.[1]; assert.ok(targeted, "G01 targeted verification catalog is absent");
  const targetedCommand = targeted.match(/exact command: `([^`]+)`/)?.[1], requiredJob = targeted.match(/required job: `([^`]+)`/)?.[1], caseIds = targeted.match(/case IDs `([^`]+)`, `([^`]+)`/i)?.slice(1), proofLevel = targeted.match(/highest proof \*\*(P[0-9]+)\*\*/)?.[1];
  assert.ok(targetedCommand && requiredJob && caseIds?.length === 2 && proofLevel, "G01 targeted verification catalog is malformed"); assert.equal(requiredJob, "bootstrap-plan"); assert.deepEqual(caseIds, ["G01-A01", "G01-A02"]); assert.equal(proofLevel, "P3");
  const repositoryLine = plan.match(/^- \*\*F5 repository:\*\* (.+)$/m)?.[1]; assert.ok(repositoryLine, "F5 repository catalog is absent");
  const repositoryCommands = [...repositoryLine.matchAll(/`([^`]+)`/g)].map((match) => match[1]).slice(0, 3); assert.deepEqual(repositoryCommands, ["npm run check", "TEST_DATABASE_URL=... npm test", "npm run build"]);
  assert.deepEqual(Object.keys(inputFiles).sort(), F7_INPUT_PATHS, "F7 input digest paths must be exact");
  const inputs = Object.entries(inputFiles).map(([path, bytes]) => fileRecord(path, bytes)).sort((a, b) => a.path.localeCompare(b.path));
  exactKeys(manifest, ["schemaVersion", "producer", "files"], "F7 report manifest"); assert.equal(manifest.schemaVersion, 1);
  exactKeys(manifest.producer, ["jobName", "runId", "runAttempt", "headSha", "producedAt"], "F7 report producer");
  assert.equal(manifest.producer.jobName, producerGate.name); assert.equal(manifest.producer.runId, producerGate.runId); assert.equal(manifest.producer.runAttempt, producerGate.runAttempt); assert.equal(manifest.producer.headSha, producerGate.headSha);
  const producedAt = canonicalInstant(manifest.producer.producedAt, "report producer producedAt"); assert.ok(producedAt <= canonicalInstant(producerGate.completedAt, "report producer completedAt"));
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0); assert.deepEqual(manifest.files.map(({ path }) => path), [...manifest.files.map(({ path }) => path)].sort(), "F7 reports must be path-sorted");
  assert.deepEqual(Object.keys(reportFiles).sort(), manifest.files.map(({ path }) => path), "F7 report files/manifest mismatch");
  const reports = manifest.files.map((expected) => {
    exactKeys(expected, ["path", "size", "sha256"], `F7 report ${expected.path}`); const actual = fileRecord(expected.path, reportFiles[expected.path]); assert.deepEqual(actual, expected, `F7 report bytes substituted: ${expected.path}`);
    return { ...actual, producer: { jobId: producerGate.jobId, checkRunId: producerGate.checkRunId, name: producerGate.name, runId: producerGate.runId, runAttempt: producerGate.runAttempt, headSha: producerGate.headSha, producedAt: manifest.producer.producedAt, completedAt: producerGate.completedAt } };
  });
  return { targetedCommand, requiredJob, caseIds, fixturePaths: F7_FIXTURES, proofLevel, repositoryCommands, reports, inputs };
}

export function buildF7RepositoryGates(authority, sourceSha, sourceBranch, baseSha, createdAt) {
  exactKeys(authority, ["repository", "expectedRunId", "expectedRunAttempt", "run", "pr", "checkSuite", "jobPages", "checkRunPages", "paginationComplete", "observedAt"], "F7 repository gate authority");
  assert.equal(authority.paginationComplete, true); assert.equal(authority.observedAt, createdAt); const run = authority.run, pr = authority.pr, suite = authority.checkSuite;
  assert.equal(run.id, authority.expectedRunId); assert.equal(run.run_attempt, authority.expectedRunAttempt); assert.equal(run.repository?.full_name, authority.repository); assert.equal(run.name, "CI/CD"); assert.equal(run.path, ".github/workflows/ci.yml"); assert.equal(run.event, "pull_request"); assert.equal(run.head_branch, sourceBranch); assert.equal(run.head_sha, sourceSha); assert.equal(run.status, "in_progress"); assert.equal(run.conclusion, null);
  for (const key of ["id", "run_attempt", "check_suite_id", "workflow_id"]) assert.ok(Number.isInteger(run[key]) && run[key] > 0, `F7 run ${key} invalid`);
  assert.ok(Number.isInteger(pr.number) && pr.number > 0); assert.equal(pr.head?.sha, sourceSha); assert.equal(pr.head?.ref, sourceBranch); assert.equal(pr.head?.repo?.full_name, authority.repository); assert.equal(pr.base?.sha, baseSha); assert.equal(pr.base?.ref, "develop"); assert.equal(pr.base?.repo?.full_name, authority.repository);
  assert.equal(suite.id, run.check_suite_id); assert.equal(suite.head_sha, sourceSha); assert.equal(suite.status, "in_progress"); assert.equal(suite.conclusion, null); assert.equal(suite.app?.slug, "github-actions");
  const flatten = (pages, key, label) => { assert.ok(Array.isArray(pages) && pages.length > 0, `${label} pages absent`); const rows=pages.flatMap(page=>{assert.ok(Array.isArray(page[key]), `${label} page malformed`);return page[key]}); assert.equal(rows.length, pages[0].total_count, `${label} pagination incomplete`); return rows; };
  const jobs = flatten(authority.jobPages, "jobs", "job"), checks = flatten(authority.checkRunPages, "check_runs", "check-run");
  const requiredGates = F7_REQUIRED_GATES.map((name) => {
    const jobMatches=jobs.filter(row=>row.name===name), checkMatches=checks.filter(row=>row.name===name); assert.equal(jobMatches.length,1,`required job ${name} must resolve exactly once`); assert.equal(checkMatches.length,1,`required check-run ${name} must resolve exactly once`);
    const job=jobMatches[0], check=checkMatches[0]; assert.equal(job.id,check.id,`${name} job/check-run identity mismatch`); assert.equal(check.check_suite?.id,suite.id); assert.equal(job.run_id,run.id); assert.equal(job.run_attempt,run.run_attempt); assert.equal(job.head_sha,sourceSha); assert.equal(check.head_sha,sourceSha); assert.equal(job.status,"completed"); assert.equal(check.status,"completed"); assert.equal(job.conclusion,"success"); assert.equal(check.conclusion,"success"); assert.equal(check.details_url,`https://github.com/${authority.repository}/actions/runs/${run.id}/job/${job.id}`);
    const startedAt=authenticatedGitHubInstant(job.started_at,`${name}.startedAt`),completedAt=authenticatedGitHubInstant(job.completed_at,`${name}.completedAt`); assert.ok(startedAt<=completedAt); assert.ok(completedAt<canonicalInstant(createdAt,"F7.createdAt"),`F7 must follow ${name}`);
    return { jobId:job.id, checkRunId:check.id, checkSuiteId:suite.id, name, status:job.status, conclusion:job.conclusion, runId:job.run_id, runAttempt:job.run_attempt, headSha:job.head_sha, startedAt:new Date(startedAt).toISOString(), completedAt:new Date(completedAt).toISOString(), detailsUrl:check.details_url };
  });
  return { producerRun: { id:run.id, runAttempt:run.run_attempt, checkSuiteId:run.check_suite_id, workflowId:run.workflow_id, workflowName:run.name, workflowPath:run.path, repository:authority.repository, event:run.event, prNumber:pr.number, baseSha, headBranch:run.head_branch, headSha:run.head_sha, status:run.status, conclusion:run.conclusion }, requiredGates };
}

export function buildF7Envelope(candidateReport, sourceSha, sourceBranch, createdAt, authority, files) {
  assert.match(sourceSha, SHA); const identity=activeIdentity(candidateReport,sourceSha,sourceBranch); const timestamp=Date.parse(createdAt); assert.ok(Number.isFinite(timestamp)&&new Date(timestamp).toISOString()===createdAt,"F7 createdAt must be canonical ISO-8601 UTC");
  const baseSha=candidateReport.registries.flatMap(({candidate})=>candidate.attempts??candidate.landedAncestors??[]).find(({attemptId})=>attemptId===identity.attemptId)?.baseSha; assert.match(baseSha,SHA,"F7 base SHA is absent");
  const {producerRun,requiredGates}=buildF7RepositoryGates(authority,sourceSha,sourceBranch,baseSha,createdAt), targetedGate=requiredGates.at(-1);
  const verification=buildG01VerificationCatalog(files.plan,files.spec,files.inputs,files.reports,files.reportManifest,targetedGate);
  const digestAuthority={candidateReport,baseSha,sourceSha,producerRun,requiredGates,verification};
  return validateEnvelope({schemaVersion:1,goal:"G01",phase:"F7",status:"GREEN",evidenceId:`ci-bundle.${identity.suffix}`,attemptId:identity.attemptId,sourceBranch,baseSha,sourceSha,producerRun,requiredGates,verification,digest:`sha256:${crypto.createHash("sha256").update(JSON.stringify(digestAuthority)).digest("hex")}`,createdAt},"F7");
}

function githubCliAdapter(repository) {
  const maxBuffer = 128 * 1024 * 1024;
  const call = (args, input) => { const result = spawnSync("gh", ["api", ...args], { encoding: "utf8", input, maxBuffer }); if (result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || `gh api failed (${result.status})`); return result.stdout.trim() ? JSON.parse(result.stdout) : null; };
  return {
    get: (endpoint) => call([endpoint]),
    paginate: (endpoint, variables) => { const fields = Object.entries(variables).flatMap(([key, value]) => ["-f", `${key}=${value}`]); return call(["--method", "GET", "--paginate", "--slurp", endpoint, ...fields]); },
    deleteRef: (ref, observedSha) => {
      const fullRef = `refs/${ref}`;
      const result = spawnSync("git", ["push", `--force-with-lease=${fullRef}:${observedSha}`, "origin", `:${fullRef}`], { encoding: "utf8", maxBuffer });
      if (result.status !== 0) throw new Error(`cleanup ref changed or was recreated; WAITING: ${result.stderr || result.stdout}`);
      return { operation: "compare-and-delete", deleted: fullRef, observedSha, result: "deleted" };
    },
    listCommitStatuses: (sha) => call([`repos/${repository}/commits/${sha}/statuses`]),
    createCommitStatus: (sha, body) => call(["--method", "POST", `repos/${repository}/statuses/${sha}`, "--input", "-"], JSON.stringify(body)),
    readArtifact: (metadata) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g01-prior-artifact-"));
      try {
        const archivePath = path.join(directory, "artifact.zip");
        const downloaded = spawnSync("gh", ["api", `repos/${repository}/actions/artifacts/${metadata.id}/zip`], { encoding: null, maxBuffer });
        if (downloaded.status !== 0) throw new Error(Buffer.from(downloaded.stderr ?? "").toString("utf8") || "artifact download failed");
        fs.writeFileSync(archivePath, downloaded.stdout);
        const extract = path.join(directory, "extract"); fs.mkdirSync(extract);
        const unzipped = spawnSync("unzip", ["-q", archivePath, "-d", extract], { encoding: "utf8", maxBuffer });
        if (unzipped.status !== 0) throw new Error(unzipped.stderr || "artifact extraction failed");
        const files = Object.fromEntries(fs.readdirSync(extract, { recursive: true }).filter((name) => fs.statSync(path.join(extract, name)).isFile()).map((name) => [name, fs.readFileSync(path.join(extract, name))]));
        return { archiveBytes: Buffer.from(downloaded.stdout), files };
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
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
  const optionNames = ["--source-sha", "--source-branch", "--created-at", "--activate-authority", "--f7-authority", "--report-dir", "--report-manifest", "--schema", "--config", "--workflow", "--prepare", "--plan", "--spec", "--repository", "--observed-at"];
  const excluded = new Set(["--f7", "--prepare-live", ...optionNames, ...optionNames.filter((name) => args.includes(name)).map(option)]);
  const files = args.filter((value) => !excluded.has(value));
  if (files.length === 0) throw new Error("usage: bootstrap-export.mjs REGISTRY.json [REGISTRY.json]");
  if (prepareLive) {
    const repository = option("--repository");
    const git = (...command) => { const result = spawnSync("git", command, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); if (result.status !== 0) throw new Error(result.error?.message || result.stderr || `git ${command.join(" ")} failed`); return result.stdout.trim(); };
    assert.equal(git("status", "--porcelain"), "", "live preparation rejects a dirty candidate worktree");
    const reviewedHeadSha = git("rev-parse", "HEAD"), reviewedBaseSha = git("rev-parse", "origin/develop");
    const changed = git("diff", "--name-only", `${reviewedBaseSha}...${reviewedHeadSha}`).split("\n").filter(Boolean);
    assert.ok(changed.every((name) => G01_WRITABLE.includes(name)), `live preparation rejects unallowlisted reviewed paths: ${changed.filter((name) => !G01_WRITABLE.includes(name)).join(",")}`);
    const indexModes = new Map(git("ls-files", "--stage", "--", ...G01_WRITABLE).split("\n").filter(Boolean).map((line) => { const match = line.match(/^(100(?:644|755)) [0-9a-f]{40} [0-3]\t(.+)$/); assert.ok(match, `unsupported G01 index entry: ${line}`); return [match[2], match[1]]; }));
    const candidateFiles = G01_WRITABLE.map((filename) => ({ filename, mode: indexModes.get(filename), bytes: fs.readFileSync(filename) }));
    const result = await prepareAndCreateBootstrapBranch({ api: githubCliAdapter(repository), repository, registries: files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })), candidateFiles, reviewedBaseSha, reviewedHeadSha, observedAt: args.includes("--observed-at") ? option("--observed-at") : () => new Date().toISOString() });
    process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(0);
  }
  let report = buildCandidateReport(files.map((filename) => ({ filename, bytes: fs.readFileSync(filename) })));
  if (activationPath) report = activateCandidateReport(report, JSON.parse(fs.readFileSync(activationPath, "utf8")), fs.readFileSync(option("--plan")), fs.readFileSync(option("--spec"))).report;
  let f7Files;
  if (f7) {
    const planPath = option("--plan"), specPath = option("--spec"), schemaPath = option("--schema"), configPath = option("--config"), workflowPath = option("--workflow"), manifest = JSON.parse(fs.readFileSync(option("--report-manifest"), "utf8")), reportDir = option("--report-dir");
    const reports = Object.fromEntries(manifest.files.map(({ path: reportPath }) => [reportPath, fs.readFileSync(path.join(reportDir, path.basename(reportPath)))]));
    f7Files = { plan: fs.readFileSync(planPath), spec: fs.readFileSync(specPath), reportManifest: manifest, reports, inputs: { [planPath]: fs.readFileSync(planPath), [specPath]: fs.readFileSync(specPath), [schemaPath]: fs.readFileSync(schemaPath), [configPath]: fs.readFileSync(configPath), [workflowPath]: fs.readFileSync(workflowPath) } };
  }
  const output = preparePath ? prepareBootstrapAuthority(report, JSON.parse(fs.readFileSync(preparePath, "utf8"))) : f7 ? buildF7Envelope(report, option("--source-sha"), option("--source-branch"), option("--created-at"), JSON.parse(fs.readFileSync(option("--f7-authority"), "utf8")), f7Files) : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
