#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PHASE_PREFIX = { F7: "ci-bundle", F9: "approval-envelope", F11: "merge-envelope" };
const REVIEW_ROLES = ["code-reviewer", "architect", "verifier"];
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function exactKeys(value, allowed, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...allowed].sort(), `${label} keys must be exact`);
}
function instant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  const time = Date.parse(value); assert.ok(Number.isFinite(time) && new Date(time).toISOString() === value, `${label} must be canonical ISO-8601 UTC`); return time;
}
function compactDigest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function outputDigest(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function lineage(envelope) {
  const suffix = envelope.evidenceId.slice(envelope.evidenceId.indexOf(".") + 1);
  if (envelope.sourceBranch === "feature/2.5.0-g01-canonical-evidence-bootstrap") {
    assert.match(envelope.attemptId, /^g01-a[0-9]{2,}$/); assert.equal(suffix, "g01.json");
  } else {
    const ordinal = envelope.sourceBranch.match(/^feature\/2\.5\.0-g01-postmerge-bootstrap-a([0-9]{2,})$/)?.[1];
    assert.ok(ordinal, "invalid recovery branch"); assert.equal(envelope.attemptId, `g01-recovery-a${ordinal}`); assert.equal(suffix, `bootstrap-recovery-a${ordinal}.json`);
    assert.ok(Number(ordinal) >= 2, "recovery ordinal must follow the direct attempt");
  }
  return suffix;
}
function validatePostMergeRun(run, sourceSha) {
  exactKeys(run, ["id", "runAttempt", "checkSuiteId", "workflowId", "workflowName", "workflowPath", "repository", "event", "headBranch", "headSha", "requiredJobs"], "F11.postMergeRun");
  for (const key of ["id", "runAttempt", "checkSuiteId", "workflowId"]) assert.ok(Number.isInteger(run[key]) && run[key] > 0, `postMergeRun.${key} invalid`);
  assert.equal(run.workflowName, "CI/CD"); assert.equal(run.workflowPath, ".github/workflows/ci.yml"); assert.equal(typeof run.repository, "string"); assert.ok(run.repository.includes("/"));
  assert.equal(run.event, "push"); assert.equal(run.headBranch, "develop"); assert.equal(run.headSha, sourceSha);
  assert.ok(Array.isArray(run.requiredJobs)); assert.equal(run.requiredJobs.length, 2); assert.deepEqual(run.requiredJobs.map(({ name }) => name), ["Lint, typecheck & build", "Tests"]);
  const ids = new Set();
  for (const [index, job] of run.requiredJobs.entries()) {
    exactKeys(job, ["id", "name", "status", "conclusion", "runId", "runAttempt", "headSha"], `F11.requiredJobs[${index}]`);
    assert.ok(Number.isInteger(job.id) && job.id > 0); assert.ok(!ids.has(job.id)); ids.add(job.id);
    assert.equal(job.status, "completed"); assert.equal(job.conclusion, "success"); assert.equal(job.runId, run.id); assert.equal(job.runAttempt, run.runAttempt); assert.equal(job.headSha, run.headSha);
  }
  return run;
}

export function validateEnvelope(envelope, expectedPhase) {
  const common = ["schemaVersion", "goal", "phase", "status", "evidenceId", "attemptId", "sourceBranch", "sourceSha", "digest", "createdAt"];
  const phaseFields = expectedPhase === "F9" ? ["f7Digest", "reviewObjects"] : expectedPhase === "F11"
    ? ["f7Digest", "f9Digest", "mergeSha", "terminalDevelopSha", "remoteDeleted", "mergedAt", "remoteDeletionObservedAt", "prNumber", "postMergeRun"] : [];
  exactKeys(envelope, [...common, ...phaseFields], `${expectedPhase} envelope`);
  assert.equal(envelope.schemaVersion, 1); assert.equal(envelope.goal, "G01"); assert.equal(envelope.phase, expectedPhase); assert.equal(envelope.status, "GREEN");
  assert.match(envelope.sourceSha, SHA); assert.match(envelope.digest, DIGEST); instant(envelope.createdAt, `${expectedPhase}.createdAt`);
  assert.match(envelope.evidenceId, new RegExp(`^${PHASE_PREFIX[expectedPhase]}\\.(?:g01|bootstrap-recovery-a[0-9]{2,})\\.json$`)); lineage(envelope);
  if (expectedPhase === "F9") {
    assert.match(envelope.f7Digest, DIGEST); assert.ok(Array.isArray(envelope.reviewObjects) && envelope.reviewObjects.length === 3);
    assert.deepEqual(envelope.reviewObjects.map(({ role }) => role), REVIEW_ROLES);
    const commentIds = new Set(), nodeIds = new Set(), actorIds = new Set(), laneIds = new Set(), outputDigests = new Set();
    for (const [index, review] of envelope.reviewObjects.entries()) {
      exactKeys(review, ["schemaVersion", "kind", "role", "verdict", "repository", "prNumber", "headSha", "attemptId", "f7ArtifactId", "f7ArtifactName", "f7ArchiveDigest", "f7PayloadDigest", "f7Digest", "laneId", "output", "outputDigest", "parentReferences", "commentId", "nodeId", "actorId", "authorAssociation", "createdAt"], `F9.reviewObjects[${index}]`);
      assert.equal(review.schemaVersion, 1); assert.equal(review.kind, "g01-native-review"); assert.equal(review.attemptId, envelope.attemptId); assert.equal(review.headSha, envelope.sourceSha); assert.equal(review.f7Digest, envelope.f7Digest);
      assert.match(review.repository, /^[^/]+\/[^/]+$/); assert.ok(Number.isInteger(review.prNumber) && review.prNumber > 0); assert.ok(Number.isInteger(review.f7ArtifactId) && review.f7ArtifactId > 0); assert.ok(typeof review.f7ArtifactName === "string" && review.f7ArtifactName.length > 0);
      for (const key of ["f7ArchiveDigest", "f7PayloadDigest", "f7Digest", "outputDigest"]) assert.match(review[key], DIGEST);
      assert.match(review.laneId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); assert.ok(typeof review.output === "string" && review.output.length > 0 && Buffer.byteLength(review.output) <= 48000); assert.equal(review.outputDigest, outputDigest(review.output));
      assert.ok(Number.isInteger(review.commentId) && review.commentId > 0); assert.ok(typeof review.nodeId === "string" && review.nodeId.length > 0); assert.ok(Number.isInteger(review.actorId) && review.actorId > 0); assert.ok(TRUSTED_ASSOCIATIONS.has(review.authorAssociation));
      assert.equal(review.verdict, review.role === "architect" ? "CLEAR" : "APPROVE"); assert.ok(instant(review.createdAt, `F9.reviewObjects[${index}].createdAt`) < instant(envelope.createdAt, "F9.createdAt"), "F9 must follow every native review comment");
      assert.ok(!commentIds.has(review.commentId)); assert.ok(!nodeIds.has(review.nodeId)); assert.ok(!laneIds.has(review.laneId)); assert.ok(!outputDigests.has(review.outputDigest)); commentIds.add(review.commentId); nodeIds.add(review.nodeId); actorIds.add(review.actorId); laneIds.add(review.laneId); outputDigests.add(review.outputDigest);
      if (review.role === "verifier") {
        assert.deepEqual(review.parentReferences, envelope.reviewObjects.slice(0, 2).map(({ role, commentId, outputDigest }) => ({ role, commentId, outputDigest })));
        assert.ok(envelope.reviewObjects.slice(0, 2).every(({ createdAt }) => instant(createdAt, "parent review createdAt") < instant(review.createdAt, "verifier createdAt")));
      } else assert.deepEqual(review.parentReferences, []);
    }
    assert.equal(actorIds.size, 1, "native review comments must share one transport actor");
    const first = envelope.reviewObjects[0]; for (const review of envelope.reviewObjects.slice(1)) for (const key of ["repository", "prNumber", "headSha", "attemptId", "f7ArtifactId", "f7ArtifactName", "f7ArchiveDigest", "f7PayloadDigest", "f7Digest"]) assert.equal(review[key], first[key], `F9 review identity ${key} mismatch`);
    assert.equal(envelope.digest, compactDigest(envelope.reviewObjects));
  }
  if (expectedPhase === "F11") {
    assert.match(envelope.f7Digest, DIGEST); assert.match(envelope.f9Digest, DIGEST); assert.match(envelope.mergeSha, SHA); assert.match(envelope.terminalDevelopSha, SHA);
    assert.equal(envelope.sourceSha, envelope.mergeSha); assert.equal(envelope.terminalDevelopSha, envelope.mergeSha); assert.equal(envelope.remoteDeleted, true); assert.ok(Number.isInteger(envelope.prNumber) && envelope.prNumber > 0);
    validatePostMergeRun(envelope.postMergeRun, envelope.mergeSha);
    assert.equal(envelope.digest, compactDigest({ prNumber: envelope.prNumber, mergeSha: envelope.mergeSha, postMergeRun: envelope.postMergeRun }));
    assert.ok(instant(envelope.mergedAt, "F11.mergedAt") <= instant(envelope.remoteDeletionObservedAt, "F11.remoteDeletionObservedAt"));
    assert.ok(instant(envelope.remoteDeletionObservedAt, "F11.remoteDeletionObservedAt") <= instant(envelope.createdAt, "F11.createdAt"));
  }
  return envelope;
}

export function validateEnvelopeChain(f7, f9, f11) {
  validateEnvelope(f7, "F7"); validateEnvelope(f9, "F9"); validateEnvelope(f11, "F11");
  assert.equal(f7.sourceSha, f9.sourceSha); assert.equal(f7.attemptId, f9.attemptId); assert.equal(f9.attemptId, f11.attemptId); assert.equal(f7.sourceBranch, f9.sourceBranch); assert.equal(f9.sourceBranch, f11.sourceBranch);
  assert.equal(f9.f7Digest, f7.digest); assert.equal(f11.f7Digest, f7.digest); assert.equal(f11.f9Digest, f9.digest);
  const suffixes = [f7, f9, f11].map(({ evidenceId }) => evidenceId.slice(evidenceId.indexOf(".") + 1)); assert.equal(new Set(suffixes).size, 1);
  assert.ok(instant(f7.createdAt, "F7.createdAt") < instant(f9.createdAt, "F9.createdAt")); assert.ok(instant(f9.createdAt, "F9.createdAt") < instant(f11.mergedAt, "F11.mergedAt"));
  return { terminalDevelopSha: f11.terminalDevelopSha, lineageSuffix: suffixes[0] };
}

function runBootstrapFixture() {
  const head = "a".repeat(40), merge = "b".repeat(40), branch = "feature/2.5.0-g01-canonical-evidence-bootstrap", attemptId = "g01-a02";
  const f7 = { schemaVersion: 1, goal: "G01", phase: "F7", status: "GREEN", evidenceId: "ci-bundle.g01.json", attemptId, sourceBranch: branch, sourceSha: head, digest: `sha256:${"1".repeat(64)}`, createdAt: "2026-07-18T00:00:00.000Z" };
  const reviewObjects = REVIEW_ROLES.map((role, index) => { const output = `${role} exact-head output`; return { schemaVersion: 1, kind: "g01-native-review", role, verdict: role === "architect" ? "CLEAR" : "APPROVE", repository: "dazeGG/VoiceRoom", prNumber: 1, headSha: head, attemptId, f7ArtifactId: 7, f7ArtifactName: `g01-candidate-${attemptId}-run-10-attempt-1-head-${head}`, f7ArchiveDigest: `sha256:${"2".repeat(64)}`, f7PayloadDigest: `sha256:${"3".repeat(64)}`, f7Digest: f7.digest, laneId: `native-${role}`, output, outputDigest: outputDigest(output), parentReferences: [], commentId: index + 1, nodeId: `C${index + 1}`, actorId: 11, authorAssociation: "OWNER", createdAt: `2026-07-18T00:00:${index + 1}0.000Z` }; });
  reviewObjects[2].parentReferences = reviewObjects.slice(0, 2).map(({ role, commentId, outputDigest }) => ({ role, commentId, outputDigest }));
  const f9 = { ...f7, phase: "F9", evidenceId: "approval-envelope.g01.json", digest: compactDigest(reviewObjects), createdAt: "2026-07-18T00:01:00.000Z", f7Digest: f7.digest, reviewObjects };
  const requiredJobs = ["Lint, typecheck & build", "Tests"].map((name, index) => ({ id: index + 1, name, status: "completed", conclusion: "success", runId: 10, runAttempt: 1, headSha: merge }));
  const postMergeRun = { id: 10, runAttempt: 1, checkSuiteId: 20, workflowId: 30, workflowName: "CI/CD", workflowPath: ".github/workflows/ci.yml", repository: "dazeGG/VoiceRoom", event: "push", headBranch: "develop", headSha: merge, requiredJobs };
  const f11 = { schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: "merge-envelope.g01.json", attemptId, sourceBranch: branch, sourceSha: merge, digest: compactDigest({ prNumber: 1, mergeSha: merge, postMergeRun }), createdAt: "2026-07-18T00:04:00.000Z", f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: merge, terminalDevelopSha: merge, remoteDeleted: true, mergedAt: "2026-07-18T00:02:00.000Z", remoteDeletionObservedAt: "2026-07-18T00:03:00.000Z", prNumber: 1, postMergeRun };
  validateEnvelopeChain(f7, f9, f11); console.log("bootstrap envelope fixture: PASS");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtureIndex = process.argv.indexOf("--fixture"); if (fixtureIndex < 0 || process.argv[fixtureIndex + 1] !== "bootstrap") throw new Error("only --fixture bootstrap is supported during G01"); runBootstrapFixture();
}
