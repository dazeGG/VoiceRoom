#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validateEnvelope, validateEnvelopeChain } from "./validate-envelope.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW_PATH = ".github/workflows/ci.yml";
const WORKFLOW_NAME = "CI/CD";
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const ROLE_MARKERS = [
  ["code-reviewer", "APPROVE", "[omx-role:code-reviewer verdict:APPROVE]"],
  ["architect", "CLEAR", "[omx-role:architect verdict:CLEAR]"],
  ["verifier", "APPROVE", "[omx-role:verifier verdict:APPROVE]"],
];

function argument(name, optional = false) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    if (optional) return undefined;
    throw new Error(`missing ${name}`);
  }
  return process.argv[index + 1];
}

function exactKeys(value, allowed, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...allowed].sort(), `${label} keys must be exact`);
}

function instant(value, label) {
  assert.equal(typeof value, "string", `${label} must be a timestamp`);
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, `${label} must be canonical ISO-8601 UTC`);
  return parsed;
}

function compactDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function envelopePayloadDigest(envelope) {
  return `sha256:${crypto.createHash("sha256").update(`${JSON.stringify(envelope)}\n`).digest("hex")}`;
}

export function artifactName(phase, envelope, runId, runAttempt, headSha = envelope.sourceSha) {
  assert.ok(["candidate", "approval", "merge", "selection", "bootstrap-failure"].includes(phase));
  assert.ok(Number.isInteger(runId) && runId > 0); assert.ok(Number.isInteger(runAttempt) && runAttempt > 0); assert.match(headSha, SHA);
  return `g01-${phase}-${envelope.attemptId}-run-${runId}-attempt-${runAttempt}-head-${headSha}`;
}

function reportRegistry(report, name) {
  assert.ok(Array.isArray(report?.registries), "candidate report must contain registries");
  const matches = report.registries.filter((item) => item.name === name);
  assert.equal(matches.length, 1, `candidate report must contain exactly one ${name}`);
  return matches[0].candidate;
}

export function resolveCandidateIdentity(candidateReport, branch, sourceSha) {
  assert.match(sourceSha, SHA);
  if (branch === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    const registry = reportRegistry(candidateReport, "bootstrap-attempts.json");
    assert.equal(registry.state, "G01_PREMERGE_ACTIVE", "direct candidate registry must be active");
    const matches = registry.attempts.filter((entry) => entry.attemptId === registry.currentAttempt);
    assert.equal(matches.length, 1, "direct current attempt must resolve exactly once");
    const entry = matches[0];
    assert.equal(entry.branch, branch); assert.equal(entry.headSha, sourceSha);
    const ordinal = Number(entry.attemptId.match(/^g01-a([0-9]{2,})$/)?.[1]);
    assert.ok(Number.isInteger(ordinal) && ordinal === entry.ordinal, "direct attempt ordinal must match its ID suffix");
    return { attemptId: entry.attemptId, terminalKind: "direct-canonical", suffix: "g01.json", ordinal };
  }
  const branchMatch = branch.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/);
  assert.ok(branchMatch, "source branch is not a canonical G01 lifecycle branch");
  const registry = reportRegistry(candidateReport, "bootstrap-landed-recoveries.json");
  assert.equal(registry.state, "G01_PREMERGE_ACTIVE", "recovery candidate registry must be active");
  const matches = registry.landedAncestors.filter((entry) => entry.attemptId === registry.currentRecovery);
  assert.equal(matches.length, 1, "recovery current attempt must resolve exactly once");
  const entry = matches[0];
  const ordinal = Number(branchMatch[1]);
  assert.ok(ordinal >= 2, "recovery ordinal must follow the direct attempt");
  assert.equal(entry.branch, branch); assert.equal(entry.headSha, sourceSha);
  assert.equal(entry.attemptId, `g01-recovery-a${branchMatch[1]}`, "recovery ID/branch suffix mismatch");
  return { attemptId: entry.attemptId, terminalKind: "landed-recovery", suffix: `bootstrap-recovery-a${branchMatch[1]}.json`, ordinal };
}

function validateArtifactAuthority(authority, expected, label) {
  exactKeys(authority, ["metadata", "run", "downloadDigest", "payloadDigest", "matchCount"], `${label} artifact authority`);
  const { metadata, run } = authority;
  assert.equal(authority.matchCount, 1, `${label} artifact lookup must be unique`);
  assert.ok(Number.isInteger(metadata.id) && metadata.id > 0, `${label} artifact ID is invalid`);
  assert.equal(metadata.name, expected.name, `${label} artifact name mismatch`);
  assert.equal(metadata.expired, false, `${label} artifact expired`);
  assert.match(metadata.digest, DIGEST, `${label} GitHub digest missing`);
  assert.equal(authority.downloadDigest, metadata.digest, `${label} downloaded archive digest mismatch`);
  assert.match(authority.payloadDigest, DIGEST, `${label} payload digest missing`);
  if (expected.payload !== undefined) assert.equal(authority.payloadDigest, envelopePayloadDigest(expected.payload), `${label} parsed envelope does not match downloaded payload bytes`);
  assert.ok(instant(metadata.expires_at, `${label} artifact expires_at`) > instant(expected.observedAt, `${label} observedAt`), `${label} artifact is not live at observation`);
  assert.ok(Number.isInteger(run.id) && run.id > 0); assert.ok(Number.isInteger(run.run_attempt) && run.run_attempt > 0);
  assert.equal(metadata.workflow_run?.id, run.id, `${label} producing run ID mismatch`);
  assert.equal(metadata.workflow_run?.head_sha, expected.headSha, `${label} artifact abbreviated head mismatch`);
  assert.equal(run.head_sha, expected.headSha, `${label} producing run head mismatch`);
  assert.equal(run.head_branch, expected.headBranch, `${label} producing branch mismatch`);
  assert.equal(run.event, expected.event, `${label} producing event mismatch`);
  assert.equal(run.name, WORKFLOW_NAME, `${label} workflow name mismatch`);
  assert.equal(run.path, WORKFLOW_PATH, `${label} workflow path mismatch`);
  assert.equal(run.repository?.full_name, expected.repository, `${label} repository mismatch`);
  if (expected.runId !== undefined) assert.equal(run.id, expected.runId, `${label} producing run substitution`);
  if (expected.runAttempt !== undefined) assert.equal(run.run_attempt, expected.runAttempt, `${label} producing run attempt substitution`);
  if (expected.completed) {
    assert.equal(run.status, "completed", `${label} producing run is incomplete`);
    if (expected.success === false) { assert.equal(typeof run.conclusion, "string", `${label} failure conclusion is absent`); assert.notEqual(run.conclusion, "success", `${label} failure ancestor cannot come from a green run`); }
    else assert.equal(run.conclusion, "success", `${label} producing run is not green`);
  }
  return authority;
}

function normalizeReviews(authority, sourceSha, f7CreatedAt) {
  exactKeys(authority.reviewAuthority, ["code-reviewer", "architect", "verifier"], "review authority mapping");
  const authorized = new Map(Object.entries(authority.reviewAuthority).map(([role, actorId]) => {
    assert.ok(Number.isInteger(actorId) && actorId > 0, `${role} authorized actor ID must be configured`);
    return [role, actorId];
  }));
  assert.equal(new Set(authorized.values()).size, 3, "approval roles require three distinct authorized actors");
  assert.ok(Array.isArray(authority.reviews), "GitHub reviews response must be an array");
  const latestByActor = new Map();
  for (const review of authority.reviews) {
    if (!Number.isInteger(review.user?.id) || !review.submitted_at) continue;
    const previous = latestByActor.get(review.user.id);
    if (!previous || instant(previous.submitted_at, "previous review submitted_at") < instant(review.submitted_at, "review submitted_at")) latestByActor.set(review.user.id, review);
  }
  const normalized = ROLE_MARKERS.map(([role, verdict, marker]) => {
    const matches = [...latestByActor.values()].filter((review) => review.state === "APPROVED"
      && review.commit_id === sourceSha
      && review.user?.id === authorized.get(role)
      && TRUSTED_ASSOCIATIONS.has(review.author_association)
      && typeof review.body === "string" && review.body.includes(marker)
      && ROLE_MARKERS.filter(([, , candidate]) => review.body.includes(candidate)).length === 1);
    assert.equal(matches.length, 1, `expected exactly one authorized immutable ${role} review on the candidate head`);
    const review = matches[0];
    assert.ok(Number.isInteger(review.id) && review.id > 0);
    assert.equal(typeof review.node_id, "string"); assert.ok(review.node_id.length > 0);
    instant(review.submitted_at, `${role} review submitted_at`);
    assert.ok(instant(f7CreatedAt, "F7.createdAt") < instant(review.submitted_at, `${role} review submitted_at`), `${role} review must follow F7`);
    return { role, verdict, reviewId: review.id, nodeId: review.node_id, actorId: review.user.id, commitId: review.commit_id, submittedAt: review.submitted_at };
  });
  const byRole = new Map(normalized.map((review) => [review.role, review]));
  const verifierAt = instant(byRole.get("verifier").submittedAt, "verifier review submitted_at");
  assert.ok(instant(byRole.get("code-reviewer").submittedAt, "code-reviewer review submitted_at") < verifierAt, "verifier approval must follow code-reviewer approval");
  assert.ok(instant(byRole.get("architect").submittedAt, "architect review submitted_at") < verifierAt, "verifier approval must follow architect clearance");
  return normalized;
}

export function buildF9Envelope(f7, authority) {
  validateEnvelope(f7, "F7");
  exactKeys(authority, ["pr", "reviews", "reviewAuthority", "observedAt", "repository", "f7Artifact", "candidateReport", "premergeAncestorArtifacts"], "approval authority");
  assert.ok(Array.isArray(authority.premergeAncestorArtifacts), "F9 requires the premerge ancestor authentication catalog");
  for (const [index, ancestor] of authority.premergeAncestorArtifacts.entries()) {
    exactKeys(ancestor, ["evidenceId", "attemptId", "payloadDigest", "artifactId", "artifactName", "archiveDigest", "downloadDigest", "runId", "runAttempt", "headSha", "terminalDevelopSha"], `premerge ancestor ${index}`);
    assert.equal(ancestor.archiveDigest, ancestor.downloadDigest, "premerge ancestor archive digest mismatch");
    assert.match(ancestor.evidenceId, /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/);
    assert.equal(ancestor.evidenceId, `bootstrap-failure.${ancestor.attemptId}.json`);
    assert.match(ancestor.payloadDigest, DIGEST); assert.match(ancestor.archiveDigest, DIGEST);
  }
  const candidateIdentity = resolveCandidateIdentity(authority.candidateReport, f7.sourceBranch, f7.sourceSha);
  if (candidateIdentity.terminalKind === "direct-canonical") assert.equal(authority.premergeAncestorArtifacts.length, 0, "direct F9 cannot import recovery ancestors");
  else {
    const registry = reportRegistry(authority.candidateReport, "bootstrap-landed-recoveries.json");
    const currentIndex = registry.landedAncestors.findIndex(({ attemptId }) => attemptId === registry.currentRecovery);
    assert.ok(currentIndex >= 0, "recovery F9 current pointer is unresolved");
    const expected = registry.landedAncestors.slice(0, currentIndex + 1).map(({ priorFailureId, priorFailureDigest }) => ({ evidenceId: priorFailureId, payloadDigest: priorFailureDigest }));
    assert.deepEqual(authority.premergeAncestorArtifacts.map(({ evidenceId, payloadDigest }) => ({ evidenceId, payloadDigest })), expected, "recovery F9 must authenticate every ordered ancestor before approval");
  }
  assert.equal(authority.pr.state, "open"); assert.equal(authority.pr.base?.ref, "develop");
  assert.equal(authority.pr.base?.repo?.full_name, authority.repository, "PR base repository mismatch");
  assert.equal(authority.pr.head?.repo?.full_name, authority.repository, "fork PR cannot provide bootstrap authority");
  assert.equal(authority.pr.head?.sha, f7.sourceSha, "GitHub PR head must equal F7 source SHA");
  const identity = resolveCandidateIdentity(authority.candidateReport, authority.pr.head?.ref, f7.sourceSha);
  assert.equal(f7.attemptId, identity.attemptId); assert.equal(f7.sourceBranch, authority.pr.head.ref);
  assert.equal(f7.evidenceId, `ci-bundle.${identity.suffix}`);
  validateArtifactAuthority(authority.f7Artifact, { name: artifactName("candidate", f7, authority.f7Artifact.run.id, authority.f7Artifact.run.run_attempt), headSha: f7.sourceSha, headBranch: f7.sourceBranch, event: "pull_request", repository: authority.repository, observedAt: authority.observedAt, payload: f7 }, "F7");
  assert.equal(f7.digest, compactDigest(authority.candidateReport), "F7 digest must bind the candidate report bytes from the authenticated artifact");
  const reviewObjects = normalizeReviews(authority, f7.sourceSha, f7.createdAt);
  const createdAt = authority.observedAt; instant(createdAt, "approval observedAt");
  assert.ok(instant(f7.createdAt, "F7.createdAt") < instant(createdAt, "approval observedAt"), "F9 must follow F7");
  assert.ok(reviewObjects.every(({ submittedAt }) => instant(submittedAt, "review submittedAt") < instant(createdAt, "approval observedAt")), "F9 must follow every review");
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: `approval-envelope.${identity.suffix}`, attemptId: identity.attemptId, sourceBranch: f7.sourceBranch, sourceSha: f7.sourceSha, digest: compactDigest(reviewObjects), createdAt, f7Digest: f7.digest, reviewObjects }, "F9");
}

export function validateFallbackCandidatePair(f7, f9, candidateReport, authority) {
  validateEnvelope(f7, "F7"); validateEnvelope(f9, "F9");
  exactKeys(authority, ["repository", "observedAt", "f7Artifact", "f9Artifact"], "fallback candidate authority");
  const identity = resolveCandidateIdentity(candidateReport, f7.sourceBranch, f7.sourceSha);
  assert.equal(identity.attemptId, f7.attemptId); assert.equal(f9.attemptId, f7.attemptId); assert.equal(f9.sourceBranch, f7.sourceBranch); assert.equal(f9.sourceSha, f7.sourceSha); assert.equal(f9.f7Digest, f7.digest);
  assert.equal(f7.digest, compactDigest(candidateReport), "fallback F7 must bind the authenticated candidate report");
  for (const [artifact, envelope, kind, label] of [[authority.f7Artifact, f7, "candidate", "F7"], [authority.f9Artifact, f9, "approval", "F9"]]) {
    validateArtifactAuthority(artifact, { name: artifactName(kind, envelope, artifact.run.id, artifact.run.run_attempt), headSha: f7.sourceSha, headBranch: f7.sourceBranch, event: "pull_request", repository: authority.repository, observedAt: authority.observedAt, completed: true, payload: envelope }, label);
  }
  assert.equal(authority.f7Artifact.run.id, authority.f9Artifact.run.id, "fallback F7/F9 must come from one run");
  assert.equal(authority.f7Artifact.run.run_attempt, authority.f9Artifact.run.run_attempt, "fallback F7/F9 run attempt mismatch");
  return identity;
}

function validateRequiredJobs(jobs) {
  assert.ok(Array.isArray(jobs) && jobs.length === 2, "F11 requires exactly check and test job conclusions");
  assert.deepEqual(jobs.map(({ name }) => name), ["Lint, typecheck & build", "Tests"]);
  for (const [index, job] of jobs.entries()) {
    exactKeys(job, ["id", "name", "status", "conclusion", "runId", "runAttempt", "headSha"], `requiredJobs[${index}]`);
    assert.ok(Number.isInteger(job.id) && job.id > 0); assert.equal(job.status, "completed"); assert.equal(job.conclusion, "success");
  }
  assert.equal(new Set(jobs.map(({ id }) => id)).size, 2, "required jobs must be unique");
  return jobs;
}

function validatePostMergeRun(run, expected) {
  exactKeys(run, ["id", "runAttempt", "checkSuiteId", "workflowId", "workflowName", "workflowPath", "repository", "event", "headBranch", "headSha", "requiredJobs"], "postMergeRun");
  assert.ok(Number.isInteger(run.id) && run.id > 0); assert.ok(Number.isInteger(run.runAttempt) && run.runAttempt > 0);
  assert.ok(Number.isInteger(run.checkSuiteId) && run.checkSuiteId > 0); assert.ok(Number.isInteger(run.workflowId) && run.workflowId > 0);
  assert.equal(run.workflowName, WORKFLOW_NAME); assert.equal(run.workflowPath, WORKFLOW_PATH);
  assert.equal(run.repository, expected.repository); assert.equal(run.event, "push"); assert.equal(run.headBranch, "develop"); assert.equal(run.headSha, expected.mergeSha);
  const jobs = validateRequiredJobs(run.requiredJobs);
  for (const job of jobs) {
    assert.equal(job.runId, run.id); assert.equal(job.runAttempt, run.runAttempt); assert.equal(job.headSha, run.headSha);
  }
  return run;
}

export function buildF11Envelope(f7, f9, authority) {
  validateEnvelope(f7, "F7"); validateEnvelope(f9, "F9");
  exactKeys(authority, ["pr", "developRef", "sourceRefStatus", "postMergeRun", "observedAt", "repository", "f7Artifact", "f9Artifact"], "merge authority");
  assert.equal(f9.sourceSha, f7.sourceSha); assert.equal(f9.f7Digest, f7.digest); assert.equal(f9.attemptId, f7.attemptId); assert.equal(f9.sourceBranch, f7.sourceBranch);
  assert.equal(authority.pr.state, "closed"); assert.equal(authority.pr.merged, true); assert.equal(authority.pr.base?.ref, "develop");
  assert.equal(authority.pr.base?.repo?.full_name, authority.repository); assert.equal(authority.pr.head?.repo?.full_name, authority.repository);
  assert.equal(authority.pr.head?.sha, f7.sourceSha); assert.equal(authority.pr.head?.ref, f7.sourceBranch);
  assert.equal(authority.pr.merge_commit_sha, authority.developRef.object?.sha, "develop must still equal the actual squash merge");
  assert.equal(authority.sourceRefStatus, 404, "remote source branch must return GitHub API 404");
  const postMergeRun = validatePostMergeRun(authority.postMergeRun, { repository: authority.repository, mergeSha: authority.pr.merge_commit_sha });
  for (const [artifactAuthority, envelope, name, label] of [
    [authority.f7Artifact, f7, artifactName("candidate", f7, authority.f7Artifact.run.id, authority.f7Artifact.run.run_attempt), "F7"],
    [authority.f9Artifact, f9, artifactName("approval", f9, authority.f9Artifact.run.id, authority.f9Artifact.run.run_attempt), "F9"],
  ]) validateArtifactAuthority(artifactAuthority, { name, headSha: f7.sourceSha, headBranch: f7.sourceBranch, event: "pull_request", repository: authority.repository, observedAt: authority.observedAt, completed: true, payload: envelope }, label);
  assert.equal(authority.f7Artifact.run.id, authority.f9Artifact.run.id, "F7/F9 must come from one premerge workflow run");
  assert.equal(authority.f7Artifact.run.run_attempt, authority.f9Artifact.run.run_attempt, "F7/F9 run attempt mismatch");
  const mergedAt = authority.pr.merged_at; const createdAt = authority.observedAt;
  instant(mergedAt, "PR merged_at"); instant(createdAt, "merge observedAt");
  assert.ok(instant(f9.createdAt, "F9.createdAt") < instant(mergedAt, "PR merged_at"), "actual merge must follow F9");
  const payload = { prNumber: authority.pr.number, mergeSha: authority.pr.merge_commit_sha, postMergeRun };
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: f7.evidenceId.replace("ci-bundle", "merge-envelope"), attemptId: f7.attemptId, sourceBranch: f7.sourceBranch, sourceSha: authority.pr.merge_commit_sha, digest: compactDigest(payload), createdAt, f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: authority.pr.merge_commit_sha, terminalDevelopSha: authority.pr.merge_commit_sha, remoteDeleted: true, mergedAt, remoteDeletionObservedAt: createdAt, prNumber: authority.pr.number, postMergeRun }, "F11");
}

function validateAncestorFailures(value) {
  assert.ok(Array.isArray(value), "ancestorFailures must be an array");
  let previousTime = -Infinity; let previousTerminal; const ids = new Set();
  for (const [index, ancestor] of value.entries()) {
    exactKeys(ancestor, ["attemptId", "evidenceId", "digest", "artifactId", "artifactName", "archiveDigest", "runId", "runAttempt", "headSha", "baseSha", "parentSha", "terminalDevelopSha", "createdAt"], `ancestorFailures[${index}]`);
    assert.match(ancestor.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/);
    assert.equal(ancestor.evidenceId, `bootstrap-failure.${ancestor.attemptId}.json`);
    assert.match(ancestor.digest, DIGEST); assert.match(ancestor.archiveDigest, DIGEST); assert.ok(Number.isInteger(ancestor.artifactId) && ancestor.artifactId > 0); assert.ok(Number.isInteger(ancestor.runId) && ancestor.runId > 0); assert.ok(Number.isInteger(ancestor.runAttempt) && ancestor.runAttempt > 0);
    assert.equal(typeof ancestor.artifactName, "string"); assert.match(ancestor.artifactName, new RegExp(`^g01-bootstrap-failure-${ancestor.attemptId}-run-${ancestor.runId}-attempt-${ancestor.runAttempt}-head-${ancestor.terminalDevelopSha}-phase-(?:f11|selection)$`));
    for (const key of ["headSha", "baseSha", "parentSha", "terminalDevelopSha"]) assert.match(ancestor[key], SHA);
    assert.equal(ancestor.baseSha, ancestor.parentSha, "ancestor candidate must base on its frozen parent");
    if (previousTerminal) assert.equal(ancestor.baseSha, previousTerminal, "ancestor failures must form an unbroken chain");
    const timestamp = instant(ancestor.createdAt, `ancestorFailures[${index}].createdAt`); assert.ok(timestamp > previousTime, "ancestor failures must be strictly chronological");
    assert.ok(!ids.has(ancestor.evidenceId), "ancestor evidence objects must be unique"); ids.add(ancestor.evidenceId); previousTime = timestamp; previousTerminal = ancestor.terminalDevelopSha;
  }
  return value;
}

function bindAncestorArtifacts(ancestorFailures, artifacts, repository, observedAt) {
  if (ancestorFailures.length === 0) { assert.equal(artifacts, undefined, "direct selection must not supply ancestor authority"); return; }
  assert.ok(Array.isArray(artifacts)); assert.equal(artifacts.length, ancestorFailures.length);
  const byId = new Map();
  for (const authority of artifacts) {
    const id = authority.metadata?.id; assert.ok(!byId.has(id), "ancestor artifact authorities must be unique"); byId.set(id, authority);
  }
  for (const ancestor of ancestorFailures) {
    const authority = byId.get(ancestor.artifactId); assert.ok(authority, "ancestor artifact ID has no fetched authority");
    validateArtifactAuthority(authority, { name: ancestor.artifactName, headSha: ancestor.terminalDevelopSha, headBranch: "develop", event: "push", repository, observedAt, runId: ancestor.runId, runAttempt: ancestor.runAttempt, completed: true, success: false }, "ancestor");
    assert.equal(ancestor.archiveDigest, authority.metadata.digest, "ancestor archive digest mismatch");
    assert.equal(ancestor.digest, authority.payloadDigest, "ancestor evidence object digest mismatch");
  }
}

export function validateBootstrapFailure(failure) {
  exactKeys(failure, ["schemaVersion", "release", "status", "attemptId", "evidenceId", "failedPhase", "baseSha", "parentSha", "terminalDevelopSha", "headSha", "runId", "runAttempt", "createdAt", "reason", "recoveryLineage"], "bootstrap failure");
  assert.equal(failure.schemaVersion, 1); assert.equal(failure.release, "2.5.0"); assert.equal(failure.status, "G01_LANDED_UNSEALED");
  assert.match(failure.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/); assert.equal(failure.evidenceId, `bootstrap-failure.${failure.attemptId}.json`); assert.ok(["F11", "SELECTION"].includes(failure.failedPhase));
  for (const key of ["baseSha", "parentSha", "terminalDevelopSha", "headSha"]) assert.match(failure[key], SHA); assert.equal(failure.baseSha, failure.parentSha);
  assert.ok(Number.isInteger(failure.runId) && failure.runId > 0); assert.ok(Number.isInteger(failure.runAttempt) && failure.runAttempt > 0); instant(failure.createdAt, "bootstrap failure createdAt"); assert.ok(typeof failure.reason === "string" && failure.reason.length > 0);
  assert.ok(Array.isArray(failure.recoveryLineage), "bootstrap failure must carry authenticated recovery lineage");
  failure.recoveryLineage.forEach(validateRecoveryLineageEntry);
  const ordinals = failure.recoveryLineage.map((entry) => Number(entry.attemptId.match(/[0-9]+$/)?.[0]));
  assert.equal(new Set(ordinals).size, ordinals.length, "bootstrap failure recovery lineage ordinals must be unique");
  assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b), "bootstrap failure recovery lineage must be ordered");
  if (failure.attemptId.startsWith("g01-recovery-")) {
    assert.ok(failure.recoveryLineage.length > 0, "recovery failure must carry a nonempty complete lineage");
    assert.equal(failure.recoveryLineage.at(-1).attemptId, failure.attemptId, "recovery failure lineage must end at the failed recovery attempt");
  } else assert.equal(failure.recoveryLineage.length, 0, "direct failure cannot claim recovery lineage");
  return failure;
}

function validateRecoveryLineageEntry(entry, index) {
  exactKeys(entry, ["attemptId", "branch", "baseSha", "parentSha", "headSha", "authorityDigest", "planSpecPairDigest", "firstAuthoritativeId", "priorFailureId", "priorFailureDigest"], `recoveryLineage[${index}]`);
  const suffix = entry.attemptId.match(/^g01-recovery-a([0-9]{2,})$/)?.[1]; assert.ok(suffix && Number(suffix) >= 2);
  assert.equal(entry.branch, `feature/2.5.0-g01-postmerge-bootstrap-a${suffix}`);
  for (const key of ["baseSha", "parentSha", "headSha"]) assert.match(entry[key], SHA);
  for (const key of ["authorityDigest", "planSpecPairDigest", "priorFailureDigest"]) assert.match(entry[key], DIGEST);
  assert.equal(entry.parentSha, entry.baseSha); assert.equal(entry.priorFailureId.startsWith("bootstrap-failure."), true);
}

export function buildAuthenticatedEarlyFailure({ pr, currentRun, f7, f9, candidateReport, f7Artifact, f9Artifact, failedPhase, createdAt, reason, repository }) {
  const envelope = validateEnvelope(f7, "F7"); validateFallbackCandidatePair(envelope, f9, candidateReport, { repository, observedAt: createdAt, f7Artifact, f9Artifact });
  assert.equal(pr?.merged_at !== null, true, "early recorder requires an authenticated merged PR");
  assert.equal(pr?.merge_commit_sha, currentRun?.head_sha, "early recorder merge/run substitution");
  assert.equal(pr?.base?.ref, "develop"); assert.equal(pr?.base?.repo?.full_name, repository); assert.equal(pr?.head?.repo?.full_name, repository);
  assert.equal(currentRun?.event, "push"); assert.equal(currentRun?.head_branch, "develop"); assert.equal(currentRun?.path, WORKFLOW_PATH); assert.equal(currentRun?.repository?.full_name, repository);
  assert.ok(Number.isInteger(currentRun?.id) && currentRun.id > 0); assert.ok(Number.isInteger(currentRun?.run_attempt) && currentRun.run_attempt > 0);
  const named = new Map(candidateReport.registries.map(({ name, candidate }) => [name, candidate]));
  const recovery = named.get("bootstrap-landed-recoveries.json");
  const lineage = envelope.attemptId.startsWith("g01-recovery-") ? structuredClone(recovery?.landedAncestors ?? []) : [];
  const failure = { schemaVersion: 1, release: "2.5.0", status: "G01_LANDED_UNSEALED", attemptId: envelope.attemptId, evidenceId: `bootstrap-failure.${envelope.attemptId}.json`, failedPhase, baseSha: pr.base.sha, parentSha: pr.base.sha, terminalDevelopSha: currentRun.head_sha, headSha: pr.head.sha, runId: currentRun.id, runAttempt: currentRun.run_attempt, createdAt, reason, recoveryLineage: lineage };
  return validateBootstrapFailure(failure);
}

export function selectCanonicalFailure(records, ordinal, terminalDevelopSha, repository) {
  assert.ok(Array.isArray(records) && records.length > 0, "historical failure records are required");
  assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "expected failure producer repository is required");
  const expected = Number(ordinal);
  const authenticated = records.map((record) => {
    exactKeys(record, ["failure", "artifactId", "artifactName", "artifactCreatedAt", "archiveDigest", "payloadDigest", "run"], "failure record");
    const failure = validateBootstrapFailure(record.failure);
    assert.equal(Number(failure.attemptId.match(/[0-9]+$/)[0]), expected, "failure ordinal mismatch");
    assert.equal(failure.terminalDevelopSha, terminalDevelopSha, "failure terminal SHA mismatch");
    assert.match(record.archiveDigest, DIGEST); assert.match(record.payloadDigest, DIGEST);
    assert.ok(Number.isInteger(record.artifactId) && record.artifactId > 0);
    const artifactCreatedAt = instant(record.artifactCreatedAt, "failure artifact created_at"); assert.ok(instant(failure.createdAt, "failure createdAt") <= artifactCreatedAt, "failure artifact cannot predate its payload");
    assert.equal(record.run.id, failure.runId); assert.equal(record.run.run_attempt, failure.runAttempt);
    assert.equal(record.run.name, WORKFLOW_NAME); assert.equal(record.run.path, WORKFLOW_PATH);
    assert.equal(record.run.repository?.full_name, repository, "failure producer repository mismatch");
    assert.equal(record.run.head_sha, terminalDevelopSha); assert.equal(record.run.head_branch, "develop"); assert.equal(record.run.event, "push"); assert.equal(record.run.status, "completed"); assert.notEqual(record.run.conclusion, "success");
    assert.equal(record.artifactName, `g01-bootstrap-failure-${failure.attemptId}-run-${failure.runId}-attempt-${failure.runAttempt}-head-${terminalDevelopSha}-phase-${failure.failedPhase.toLowerCase()}`);
    return record;
  });
  authenticated.sort((a, b) => b.failure.runAttempt - a.failure.runAttempt || b.failure.runId - a.failure.runId || instant(b.failure.createdAt, "failure createdAt") - instant(a.failure.createdAt, "failure createdAt") || instant(b.artifactCreatedAt, "artifact createdAt") - instant(a.artifactCreatedAt, "artifact createdAt") || b.artifactId - a.artifactId);
  const winner = authenticated[0];
  const ties = authenticated.filter((record) => record.failure.runAttempt === winner.failure.runAttempt && record.failure.runId === winner.failure.runId && record.failure.createdAt === winner.failure.createdAt);
  assert.ok(ties.every((record) => record.payloadDigest === winner.payloadDigest && record.archiveDigest === winner.archiveDigest), "conflicting terminal artifacts for the canonical failed rerun");
  return winner;
}

function artifactBinding(authority) {
  return { artifactId: authority.metadata.id, artifactName: authority.metadata.name, runId: authority.run.id, runAttempt: authority.run.run_attempt, headSha: authority.run.head_sha, archiveDigest: authority.metadata.digest, payloadDigest: authority.payloadDigest };
}

function validateSelectionRun(run, f11) {
  assert.ok(run && typeof run === "object"); assert.equal(run.id, f11.postMergeRun.id); assert.equal(run.run_attempt, f11.postMergeRun.runAttempt);
  assert.equal(run.head_sha, f11.terminalDevelopSha); assert.equal(run.head_branch, "develop"); assert.equal(run.event, "push");
  assert.equal(run.name, WORKFLOW_NAME); assert.equal(run.path, WORKFLOW_PATH); assert.equal(run.repository?.full_name, f11.postMergeRun.repository);
}

export function buildSelection(f7, f9, f11, authority, ancestorFailures = [], ancestorArtifacts) {
  const { terminalDevelopSha, lineageSuffix } = validateEnvelopeChain(f7, f9, f11);
  exactKeys(authority, ["pr", "developRef", "sourceRefStatus", "postMergeRun", "selectionRun", "observedAt", "repository", "f7Artifact", "f9Artifact", "f11Artifact"], "selection authority");
  assert.equal(f7.attemptId, f9.attemptId); assert.equal(f9.attemptId, f11.attemptId); assert.equal(f7.sourceBranch, f11.sourceBranch);
  assert.equal(authority.pr.state, "closed"); assert.equal(authority.pr.merged, true); assert.equal(authority.pr.base?.ref, "develop");
  assert.equal(authority.pr.base?.repo?.full_name, authority.repository); assert.equal(authority.pr.head?.repo?.full_name, authority.repository);
  assert.equal(authority.pr.head?.ref, f11.sourceBranch); assert.equal(authority.pr.head?.sha, f7.sourceSha); assert.equal(authority.pr.number, f11.prNumber); assert.equal(authority.pr.merge_commit_sha, f11.mergeSha);
  assert.equal(authority.developRef.object?.sha, terminalDevelopSha); assert.equal(authority.sourceRefStatus, 404);
  assert.deepEqual(authority.postMergeRun, f11.postMergeRun, "selection must re-fetch the exact F11 post-merge authority");
  validatePostMergeRun(authority.postMergeRun, { repository: authority.repository, mergeSha: terminalDevelopSha });
  validateSelectionRun(authority.selectionRun, f11);
  for (const [artifactAuthority, envelope, name, headSha, branch, event, label] of [
    [authority.f7Artifact, f7, artifactName("candidate", f7, authority.f7Artifact.run.id, authority.f7Artifact.run.run_attempt), f7.sourceSha, f7.sourceBranch, "pull_request", "F7"],
    [authority.f9Artifact, f9, artifactName("approval", f9, authority.f9Artifact.run.id, authority.f9Artifact.run.run_attempt), f7.sourceSha, f7.sourceBranch, "pull_request", "F9"],
    [authority.f11Artifact, f11, artifactName("merge", f11, f11.postMergeRun.id, f11.postMergeRun.runAttempt), terminalDevelopSha, "develop", "push", "F11"],
  ]) validateArtifactAuthority(artifactAuthority, { name, headSha, headBranch: branch, event, repository: authority.repository, observedAt: authority.observedAt, runId: label === "F11" ? f11.postMergeRun.id : undefined, runAttempt: label === "F11" ? f11.postMergeRun.runAttempt : undefined, completed: label !== "F11", payload: envelope }, label);
  assert.equal(authority.f7Artifact.run.id, authority.f9Artifact.run.id, "F7/F9 must come from one premerge workflow run");
  assert.equal(authority.f7Artifact.run.run_attempt, authority.f9Artifact.run.run_attempt, "F7/F9 run attempt mismatch");
  const ancestors = validateAncestorFailures(ancestorFailures); bindAncestorArtifacts(ancestors, ancestorArtifacts, authority.repository, authority.observedAt);
  if (f11.sourceBranch === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    assert.match(f11.attemptId, /^g01-a[0-9]{2,}$/); assert.equal(lineageSuffix, "g01.json"); assert.equal(ancestors.length, 0);
  } else {
    const suffix = f11.sourceBranch.match(/-a([0-9]{2,})$/)?.[1];
    assert.ok(Number(suffix) >= 2, "recovery ordinal must follow the direct attempt");
    assert.equal(f11.attemptId, `g01-recovery-a${suffix}`); assert.equal(lineageSuffix, `bootstrap-recovery-a${suffix}.json`); assert.ok(ancestors.length > 0);
    assert.equal(authority.pr.base?.sha, ancestors.at(-1).terminalDevelopSha);
  }
  const createdAt = authority.observedAt; assert.ok(instant(f11.createdAt, "F11.createdAt") < instant(createdAt, "selection observedAt"));
  const core = { schemaVersion: 1, release: "2.5.0", evidenceId: `bootstrap-selection.${f11.attemptId}.json`, attemptId: f11.attemptId, terminalKind: f11.sourceBranch.includes("postmerge-bootstrap") ? "landed-recovery" : "direct-canonical", f7Id: f7.evidenceId, f7Digest: f7.digest, f9Id: f9.evidenceId, f9Digest: f9.digest, f11Id: f11.evidenceId, f11Digest: f11.digest, terminalDevelopSha, createdAt, remoteDeleted: true, status: "SELECTED_GREEN", ancestorFailures: ancestors, bootstrapSupersessionChainDigest: compactDigest(ancestors), artifactBindings: { f7: artifactBinding(authority.f7Artifact), f9: artifactBinding(authority.f9Artifact), f11: artifactBinding(authority.f11Artifact) } };
  return { ...core, selectionDigest: compactDigest(core) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f7 = JSON.parse(fs.readFileSync(argument("--f7"), "utf8")); const authority = JSON.parse(fs.readFileSync(argument("--authority"), "utf8")); let output;
  if (process.argv.includes("--emit-f9")) output = buildF9Envelope(f7, authority);
  else {
    const f9 = JSON.parse(fs.readFileSync(argument("--f9"), "utf8"));
    if (process.argv.includes("--emit-f11")) output = buildF11Envelope(f7, f9, authority);
    else {
      const f11 = JSON.parse(fs.readFileSync(argument("--f11"), "utf8")); const ancestorsPath = argument("--ancestors", true); const ancestorArtifactsPath = argument("--ancestor-artifacts", true);
      assert.equal(Boolean(ancestorsPath), Boolean(ancestorArtifactsPath), "--ancestors and --ancestor-artifacts must be supplied together");
      output = buildSelection(f7, f9, f11, authority, ancestorsPath ? JSON.parse(fs.readFileSync(ancestorsPath, "utf8")) : [], ancestorArtifactsPath ? JSON.parse(fs.readFileSync(ancestorArtifactsPath, "utf8")) : undefined);
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
