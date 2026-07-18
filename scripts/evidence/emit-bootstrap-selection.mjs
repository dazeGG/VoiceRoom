#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validateEnvelope, validateEnvelopeChain } from "./validate-envelope.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
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

function branchIdentity(branch) {
  if (branch === "feature/2.5.0-g01-canonical-evidence-bootstrap") return { attemptId: "g01-a01", terminalKind: "direct-canonical", suffix: "g01.json" };
  const match = branch.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/);
  assert.ok(match, "source branch is not a canonical G01 lifecycle branch");
  return { attemptId: `g01-recovery-a${match[1]}`, terminalKind: "landed-recovery", suffix: `bootstrap-recovery-a${match[1]}.json` };
}

function normalizeReviews(authority, sourceSha) {
  assert.ok(Array.isArray(authority.reviews), "GitHub reviews response must be an array");
  return ROLE_MARKERS.map(([role, verdict, marker]) => {
    const matches = authority.reviews.filter((review) => review.state === "APPROVED" && review.commit_id === sourceSha && typeof review.body === "string" && review.body.includes(marker));
    assert.equal(matches.length, 1, `expected exactly one immutable ${role} review on the candidate head`);
    const review = matches[0];
    assert.ok(Number.isInteger(review.id) && review.id > 0);
    assert.ok(Number.isInteger(review.user?.id) && review.user.id > 0);
    assert.equal(typeof review.node_id, "string"); assert.ok(review.node_id.length > 0);
    instant(review.submitted_at, `${role} review submitted_at`);
    return { role, verdict, reviewId: review.id, nodeId: review.node_id, actorId: review.user.id, commitId: review.commit_id, submittedAt: review.submitted_at };
  });
}

export function buildF9Envelope(f7, authority) {
  validateEnvelope(f7, "F7");
  exactKeys(authority, ["pr", "reviews", "observedAt", "f7Artifact", "candidateReport"], "approval authority");
  assert.equal(authority.pr.state, "open");
  assert.equal(authority.pr.base?.ref, "develop");
  assert.equal(authority.pr.head?.sha, f7.sourceSha, "GitHub PR head must equal F7 source SHA");
  const identity = branchIdentity(authority.pr.head?.ref);
  assert.equal(f7.evidenceId, `ci-bundle.${identity.suffix}`);
  assert.equal(authority.f7Artifact.expired, false);
  assert.ok(Number.isInteger(authority.f7Artifact.id) && authority.f7Artifact.id > 0);
  assert.equal(authority.f7Artifact.workflow_run?.head_sha, f7.sourceSha, "F7 artifact must come from the exact candidate head");
  assert.equal(f7.digest, compactDigest(authority.candidateReport), "F7 digest must bind the candidate report bytes from the same artifact");
  const reviewObjects = normalizeReviews(authority, f7.sourceSha);
  const createdAt = authority.observedAt; instant(createdAt, "approval observedAt");
  assert.ok(reviewObjects.every(({ submittedAt }) => instant(submittedAt, "review submittedAt") < instant(createdAt, "approval observedAt")), "F9 must follow every review");
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: `approval-envelope.${identity.suffix}`, sourceSha: f7.sourceSha, digest: compactDigest(reviewObjects), createdAt, f7Digest: f7.digest, reviewObjects }, "F9");
}

export function buildF11Envelope(f7, f9, authority) {
  validateEnvelope(f7, "F7"); validateEnvelope(f9, "F9");
  exactKeys(authority, ["pr", "developRef", "sourceRefStatus", "postMergeRun", "observedAt", "f7Artifact", "f9Artifact"], "merge authority");
  const identity = branchIdentity(authority.pr.head?.ref);
  assert.equal(f9.sourceSha, f7.sourceSha); assert.equal(f9.f7Digest, f7.digest);
  assert.equal(f7.evidenceId, `ci-bundle.${identity.suffix}`); assert.equal(f9.evidenceId, `approval-envelope.${identity.suffix}`);
  assert.equal(authority.pr.state, "closed"); assert.equal(authority.pr.merged, true);
  assert.equal(authority.pr.base?.ref, "develop"); assert.equal(authority.pr.head?.sha, f7.sourceSha);
  assert.equal(authority.pr.merge_commit_sha, authority.developRef.object?.sha, "develop must still equal the actual squash merge");
  assert.equal(authority.sourceRefStatus, 404, "remote source branch must return GitHub API 404");
  assert.equal(authority.postMergeRun.head_sha, authority.pr.merge_commit_sha);
  assert.equal(authority.postMergeRun.head_branch, "develop");
  assert.equal(authority.postMergeRun.status, "completed"); assert.equal(authority.postMergeRun.conclusion, "success");
  assert.ok(Number.isInteger(authority.postMergeRun.id) && authority.postMergeRun.id > 0);
  assert.ok(Number.isInteger(authority.postMergeRun.check_suite_id) && authority.postMergeRun.check_suite_id > 0);
  for (const [artifact, envelope, label] of [[authority.f7Artifact, f7, "F7"], [authority.f9Artifact, f9, "F9"]]) {
    assert.equal(artifact.expired, false, `${label} artifact expired`);
    assert.ok(Number.isInteger(artifact.id) && artifact.id > 0);
    assert.equal(artifact.workflow_run?.head_sha, envelope.sourceSha, `${label} artifact head mismatch`);
  }
  const mergedAt = authority.pr.merged_at; const createdAt = authority.observedAt;
  instant(mergedAt, "PR merged_at"); instant(createdAt, "merge observedAt");
  assert.ok(instant(f9.createdAt, "F9.createdAt") < instant(mergedAt, "PR merged_at"), "actual merge must follow F9");
  const payload = { prNumber: authority.pr.number, mergeSha: authority.pr.merge_commit_sha, runId: authority.postMergeRun.id, checkSuiteId: authority.postMergeRun.check_suite_id };
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: `merge-envelope.${identity.suffix}`, sourceSha: authority.pr.merge_commit_sha, digest: compactDigest(payload), createdAt, f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: authority.pr.merge_commit_sha, terminalDevelopSha: authority.pr.merge_commit_sha, remoteDeleted: true, mergedAt, remoteDeletionObservedAt: createdAt, prNumber: authority.pr.number, sourceBranch: authority.pr.head.ref, postMergeRunId: authority.postMergeRun.id, postMergeCheckSuiteId: authority.postMergeRun.check_suite_id }, "F11");
}

function validateAncestorFailures(value) {
  assert.ok(Array.isArray(value), "ancestorFailures must be an array");
  let previousTime = -Infinity; let previousTerminal;
  const ids = new Set();
  for (const [index, ancestor] of value.entries()) {
    exactKeys(ancestor, ["attemptId", "evidenceId", "digest", "artifactId", "runId", "baseSha", "parentSha", "terminalDevelopSha", "createdAt"], `ancestorFailures[${index}]`);
    assert.match(ancestor.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/);
    assert.equal(ancestor.evidenceId, `bootstrap-failure.${ancestor.attemptId}.json`);
    assert.match(ancestor.digest, DIGEST);
    assert.ok(Number.isInteger(ancestor.artifactId) && ancestor.artifactId > 0);
    assert.ok(Number.isInteger(ancestor.runId) && ancestor.runId > 0);
    for (const key of ["baseSha", "parentSha", "terminalDevelopSha"]) assert.match(ancestor[key], SHA);
    assert.equal(ancestor.baseSha, ancestor.parentSha, "ancestor candidate must base on its frozen parent");
    if (previousTerminal) assert.equal(ancestor.baseSha, previousTerminal, "ancestor external failures must form an unbroken parent/base chain");
    const timestamp = instant(ancestor.createdAt, `ancestorFailures[${index}].createdAt`);
    assert.ok(timestamp > previousTime, "ancestor failures must be strictly chronological");
    assert.ok(!ids.has(ancestor.evidenceId), "ancestor evidence objects must be unique");
    ids.add(ancestor.evidenceId); previousTime = timestamp; previousTerminal = ancestor.terminalDevelopSha;
  }
  return value;
}

export function buildSelection(f7, f9, f11, authority, ancestorFailures = []) {
  const { terminalDevelopSha, lineageSuffix } = validateEnvelopeChain(f7, f9, f11);
  exactKeys(authority, ["pr", "developRef", "sourceRefStatus", "postMergeRun", "observedAt", "f7Artifact", "f9Artifact", "f11Artifact"], "selection authority");
  const identity = branchIdentity(f11.sourceBranch);
  assert.equal(lineageSuffix, identity.suffix);
  assert.equal(authority.pr.state, "closed"); assert.equal(authority.pr.merged, true);
  assert.equal(authority.pr.base?.ref, "develop"); assert.equal(authority.pr.head?.ref, f11.sourceBranch);
  assert.equal(authority.pr.head?.sha, f7.sourceSha);
  assert.equal(authority.pr.number, f11.prNumber); assert.equal(authority.pr.merge_commit_sha, f11.mergeSha);
  assert.equal(authority.developRef.object?.sha, terminalDevelopSha);
  assert.equal(authority.sourceRefStatus, 404);
  assert.equal(authority.postMergeRun.id, f11.postMergeRunId);
  assert.equal(authority.postMergeRun.check_suite_id, f11.postMergeCheckSuiteId);
  assert.equal(authority.postMergeRun.head_sha, terminalDevelopSha);
  assert.equal(authority.postMergeRun.head_branch, "develop");
  assert.equal(authority.postMergeRun.status, "completed"); assert.equal(authority.postMergeRun.conclusion, "success");
  for (const [artifact, envelope] of [[authority.f7Artifact, f7], [authority.f9Artifact, f9], [authority.f11Artifact, f11]]) {
    assert.equal(artifact.expired, false); assert.ok(Number.isInteger(artifact.id) && artifact.id > 0);
    assert.equal(artifact.workflow_run?.head_sha, envelope.sourceSha);
  }
  const ancestors = validateAncestorFailures(ancestorFailures);
  if (identity.terminalKind === "direct-canonical") assert.equal(ancestors.length, 0);
  else {
    assert.ok(ancestors.length > 0, "landed recovery requires immutable external ancestor failures");
    assert.equal(authority.pr.base?.sha, ancestors.at(-1).terminalDevelopSha, "recovery base must bind the last landed ancestor");
  }
  const createdAt = authority.observedAt; assert.ok(instant(f11.createdAt, "F11.createdAt") < instant(createdAt, "selection observedAt"));
  return { schemaVersion: 1, release: "2.5.0", attemptId: identity.attemptId, terminalKind: identity.terminalKind, f7Id: f7.evidenceId, f7Digest: f7.digest, f9Id: f9.evidenceId, f9Digest: f9.digest, f11Id: f11.evidenceId, f11Digest: f11.digest, terminalDevelopSha, createdAt, remoteDeleted: true, status: "SELECTED_GREEN", ancestorFailures: ancestors, bootstrapSupersessionChainDigest: compactDigest(ancestors) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f7 = JSON.parse(fs.readFileSync(argument("--f7"), "utf8"));
  const authority = JSON.parse(fs.readFileSync(argument("--authority"), "utf8"));
  let output;
  if (process.argv.includes("--emit-f9")) output = buildF9Envelope(f7, authority);
  else {
    const f9 = JSON.parse(fs.readFileSync(argument("--f9"), "utf8"));
    if (process.argv.includes("--emit-f11")) output = buildF11Envelope(f7, f9, authority);
    else {
      const f11 = JSON.parse(fs.readFileSync(argument("--f11"), "utf8"));
      const ancestorsPath = argument("--ancestors", true);
      output = buildSelection(f7, f9, f11, authority, ancestorsPath ? JSON.parse(fs.readFileSync(ancestorsPath, "utf8")) : []);
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
