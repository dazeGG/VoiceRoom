#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PHASE_PREFIX = { F7: "ci-bundle", F9: "approval-envelope", F11: "merge-envelope" };
const REVIEW_ROLES = ["code-reviewer", "architect", "verifier"];

function exactKeys(value, allowed, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} has unexpected field: ${key}`);
}

function instant(value, label) {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time) && new Date(time).toISOString() === value, `${label} must be canonical ISO-8601 UTC`);
  return time;
}

function compactDigest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function validateEnvelope(envelope, expectedPhase) {
  const common = ["schemaVersion", "goal", "phase", "status", "evidenceId", "sourceSha", "digest", "createdAt"];
  const phaseFields = expectedPhase === "F9" ? ["f7Digest", "reviewObjects"] : expectedPhase === "F11"
    ? ["f7Digest", "f9Digest", "mergeSha", "terminalDevelopSha", "remoteDeleted", "mergedAt", "remoteDeletionObservedAt", "prNumber", "sourceBranch", "postMergeRunId", "postMergeCheckSuiteId"]
    : [];
  exactKeys(envelope, [...common, ...phaseFields], `${expectedPhase} envelope`);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.goal, "G01");
  assert.equal(envelope.phase, expectedPhase);
  assert.equal(envelope.status, "GREEN");
  assert.match(envelope.sourceSha, SHA);
  assert.match(envelope.digest, DIGEST);
  assert.match(envelope.evidenceId, new RegExp(`^${PHASE_PREFIX[expectedPhase]}\\.(?:g01|bootstrap-recovery-a[0-9]{2,})\\.json$`));
  instant(envelope.createdAt, `${expectedPhase}.createdAt`);
  if (expectedPhase === "F9") {
    assert.match(envelope.f7Digest, DIGEST);
    assert.ok(Array.isArray(envelope.reviewObjects) && envelope.reviewObjects.length === 3, "F9 must bind exactly three review objects");
    assert.deepEqual(envelope.reviewObjects.map(({ role }) => role), REVIEW_ROLES, "F9 review roles must be canonical and ordered");
    const ids = new Set();
    for (const [index, review] of envelope.reviewObjects.entries()) {
      exactKeys(review, ["role", "verdict", "reviewId", "nodeId", "actorId", "commitId", "submittedAt"], `F9.reviewObjects[${index}]`);
      assert.ok(Number.isInteger(review.reviewId) && review.reviewId > 0);
      assert.equal(typeof review.nodeId, "string"); assert.ok(review.nodeId.length > 0);
      assert.ok(Number.isInteger(review.actorId) && review.actorId > 0);
      assert.equal(review.commitId, envelope.sourceSha, "review must bind the unchanged candidate head");
      assert.equal(review.verdict, review.role === "architect" ? "CLEAR" : "APPROVE");
      instant(review.submittedAt, `F9.reviewObjects[${index}].submittedAt`);
      assert.ok(!ids.has(review.reviewId), "review IDs must be unique"); ids.add(review.reviewId);
    }
    assert.equal(envelope.digest, compactDigest(envelope.reviewObjects), "F9 digest must bind the immutable review objects");
  }
  if (expectedPhase === "F11") {
    assert.match(envelope.f7Digest, DIGEST);
    assert.match(envelope.f9Digest, DIGEST);
    assert.match(envelope.mergeSha, SHA);
    assert.match(envelope.terminalDevelopSha, SHA);
    assert.equal(envelope.sourceSha, envelope.mergeSha, "F11 sourceSha must be the actual merge SHA");
    assert.equal(envelope.terminalDevelopSha, envelope.mergeSha, "terminal develop SHA must equal the actual merge SHA");
    assert.equal(envelope.remoteDeleted, true, "F11 must prove remote deletion");
    assert.ok(Number.isInteger(envelope.prNumber) && envelope.prNumber > 0);
    assert.match(envelope.sourceBranch, /^feature\/2\.5\.0-g01-(?:canonical-evidence-bootstrap|postmerge-bootstrap-a[0-9]{2,})$/);
    assert.ok(Number.isInteger(envelope.postMergeRunId) && envelope.postMergeRunId > 0);
    assert.ok(Number.isInteger(envelope.postMergeCheckSuiteId) && envelope.postMergeCheckSuiteId > 0);
    assert.equal(envelope.digest, compactDigest({ prNumber: envelope.prNumber, mergeSha: envelope.mergeSha, runId: envelope.postMergeRunId, checkSuiteId: envelope.postMergeCheckSuiteId }), "F11 digest must bind the GitHub merge authority");
    assert.ok(instant(envelope.mergedAt, "F11.mergedAt") <= instant(envelope.remoteDeletionObservedAt, "F11.remoteDeletionObservedAt"), "remote deletion must follow merge");
    assert.ok(instant(envelope.remoteDeletionObservedAt, "F11.remoteDeletionObservedAt") <= instant(envelope.createdAt, "F11.createdAt"), "F11 must follow remote deletion");
  }
  return envelope;
}

export function validateEnvelopeChain(f7, f9, f11) {
  validateEnvelope(f7, "F7");
  validateEnvelope(f9, "F9");
  validateEnvelope(f11, "F11");
  assert.equal(f7.sourceSha, f9.sourceSha, "F7 and F9 must bind the same candidate head");
  assert.equal(f9.f7Digest, f7.digest, "F9 must bind the concrete F7 digest");
  assert.equal(f11.f7Digest, f7.digest, "F11 must bind the concrete F7 digest");
  assert.equal(f11.f9Digest, f9.digest, "F11 must bind the concrete F9 digest");
  const suffixes = [f7, f9, f11].map(({ evidenceId }) => evidenceId.slice(evidenceId.indexOf(".") + 1));
  assert.equal(new Set(suffixes).size, 1, "F7/F9/F11 evidence IDs must name one lineage");
  assert.ok(instant(f7.createdAt, "F7.createdAt") < instant(f9.createdAt, "F9.createdAt"), "F9 must follow F7");
  assert.ok(instant(f9.createdAt, "F9.createdAt") < instant(f11.mergedAt, "F11.mergedAt"), "merge must follow F9");
  return { terminalDevelopSha: f11.terminalDevelopSha, lineageSuffix: suffixes[0] };
}

function runBootstrapFixture() {
  const head = "a".repeat(40), merge = "b".repeat(40);
  const f7 = { schemaVersion: 1, goal: "G01", phase: "F7", status: "GREEN", evidenceId: "ci-bundle.g01.json", sourceSha: head, digest: `sha256:${"1".repeat(64)}`, createdAt: "2026-07-18T00:00:00.000Z" };
  const reviewObjects = REVIEW_ROLES.map((role, index) => ({ role, verdict: role === "architect" ? "CLEAR" : "APPROVE", reviewId: index + 1, nodeId: `R${index + 1}`, actorId: index + 11, commitId: head, submittedAt: `2026-07-18T00:00:${index + 1}0.000Z` }));
  const f9 = { schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: "approval-envelope.g01.json", sourceSha: head, digest: compactDigest(reviewObjects), createdAt: "2026-07-18T00:01:00.000Z", f7Digest: f7.digest, reviewObjects };
  const f11 = { schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: "merge-envelope.g01.json", sourceSha: merge, digest: compactDigest({ prNumber: 1, mergeSha: merge, runId: 10, checkSuiteId: 20 }), createdAt: "2026-07-18T00:04:00.000Z", f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: merge, terminalDevelopSha: merge, remoteDeleted: true, mergedAt: "2026-07-18T00:02:00.000Z", remoteDeletionObservedAt: "2026-07-18T00:03:00.000Z", prNumber: 1, sourceBranch: "feature/2.5.0-g01-canonical-evidence-bootstrap", postMergeRunId: 10, postMergeCheckSuiteId: 20 };
  validateEnvelopeChain(f7, f9, f11);
  console.log("bootstrap envelope fixture: PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtureIndex = process.argv.indexOf("--fixture");
  if (fixtureIndex < 0 || process.argv[fixtureIndex + 1] !== "bootstrap") throw new Error("only --fixture bootstrap is supported during G01");
  runBootstrapFixture();
}
