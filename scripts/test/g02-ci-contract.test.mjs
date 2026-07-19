import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  buildGoalEvidence,
  compactDigest,
  validateArtifactDownloads,
  validateBootstrapSelection,
} from "../evidence/export-goal-evidence.mjs";
import {
  buildApprovalEnvelope,
  buildApprovalEnvelopeFromAuthority,
  buildReviewComment,
  reviewOutputDigest,
} from "../evidence/seal-approval-envelope.mjs";
import { buildMergeEnvelope } from "../evidence/emit-merge-envelope.mjs";

const SHA = (value) => value.repeat(40);
const DIGEST = (value) => `sha256:${value.repeat(64)}`;
const instant = (second) => `2026-07-19T12:00:${String(second).padStart(2, "0")}.000Z`;

function artifactBinding(phase, headSha, value) {
  return {
    artifactId: value,
    artifactName: `g01-${phase}-g01-recovery-a27-run-${100 + value}-attempt-1-head-${headSha}`,
    runId: 100 + value,
    runAttempt: 1,
    headSha,
    archiveDigest: DIGEST(String(value % 10)),
    payloadDigest: DIGEST(String((value + 1) % 10)),
  };
}

function selection(overrides = {}) {
  const terminal = SHA("a");
  const premerge = SHA("b");
  const ancestor = {
    attemptId: "g01-a19",
    evidenceId: "bootstrap-failure.g01-a19.json",
    digest: DIGEST("4"),
    artifactId: 7,
    artifactName: `g01-bootstrap-failure-g01-a19-run-77-attempt-1-head-${SHA("c")}-phase-f11`,
    archiveDigest: DIGEST("5"),
    runId: 77,
    runAttempt: 1,
    headSha: SHA("d"),
    baseSha: SHA("e"),
    parentSha: SHA("e"),
    terminalDevelopSha: SHA("c"),
    createdAt: instant(0),
  };
  const core = {
    schemaVersion: 1,
    release: "2.5.0",
    evidenceId: "bootstrap-selection.g01-recovery-a27.json",
    attemptId: "g01-recovery-a27",
    terminalKind: "landed-recovery",
    f7Id: "ci-bundle.bootstrap-recovery-a27.json",
    f7Digest: DIGEST("1"),
    f9Id: "approval-envelope.bootstrap-recovery-a27.json",
    f9Digest: DIGEST("2"),
    f11Id: "merge-envelope.bootstrap-recovery-a27.json",
    f11Digest: DIGEST("3"),
    terminalDevelopSha: terminal,
    createdAt: instant(1),
    remoteDeleted: true,
    status: "SELECTED_GREEN",
    ancestorFailures: [ancestor],
    bootstrapSupersessionChainDigest: compactDigest([ancestor]),
    artifactBindings: {
      f7: artifactBinding("candidate", premerge, 11),
      f9: artifactBinding("approval", premerge, 12),
      f11: artifactBinding("merge", terminal, 13),
    },
  };
  const value = { ...core, ...overrides };
  value.selectionDigest = compactDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "selectionDigest")));
  return value;
}

function reviewInput(f7, role, index, parents = []) {
  const output = `${role} exact-head native output`;
  return {
    schemaVersion: 1,
    kind: "g02-native-review",
    role,
    verdict: role === "architect" ? "CLEAR" : "APPROVE",
    repository: "dazeGG/VoiceRoom",
    prNumber: 42,
    headSha: f7.sourceSha,
    attemptId: f7.attemptId,
    f7ArtifactId: 91,
    f7ArtifactName: `g02-candidate-g02-run-201-attempt-1-head-${f7.sourceSha}`,
    f7ArchiveDigest: DIGEST("8"),
    f7PayloadDigest: DIGEST("9"),
    f7Digest: f7.digest,
    laneId: `native-${role}-${index}`,
    output,
    parentReferences: parents,
  };
}

function authenticatedReviews(f7) {
  const parentInputs = ["code-reviewer", "architect"].map((role, index) => reviewInput(f7, role, index));
  const parents = parentInputs.map((value, index) => ({
    role: value.role,
    commentId: index + 1,
    outputDigest: reviewOutputDigest(value.output),
  }));
  const inputs = [...parentInputs, reviewInput(f7, "verifier", 2, parents)];
  return inputs.map((value, index) => ({
    ...value,
    outputDigest: reviewOutputDigest(value.output),
    commentId: index + 1,
    nodeId: `IC_${index + 1}`,
    actorId: 1001,
    authorAssociation: "OWNER",
    createdAt: instant(11 + index),
  }));
}

test("G02-A01 accepts the exact terminal recovery selection and rejects every early authority shortcut", () => {
  const value = selection();
  assert.equal(validateBootstrapSelection(value, {
    selectionArtifactId: 8442115507,
    headSha: value.terminalDevelopSha,
    originDevelopSha: value.terminalDevelopSha,
  }).selectionDigest, value.selectionDigest);

  for (const [label, bad, context] of [
    ["missing selection", null, {}],
    ["red selection", selection({ status: "G01_LANDED_UNSEALED" }), {}],
    ["remote branch retained", selection({ remoteDeleted: false }), {}],
    ["stale local head", value, { headSha: SHA("f") }],
    ["stale origin/develop", value, { originDevelopSha: SHA("f") }],
    ["unsealed ancestor", value, { headSha: value.ancestorFailures[0].terminalDevelopSha }],
    ["tracked summary", value, { authorityPath: "docs/releases/2.5.0/evidence/bootstrap-lineage.json" }],
  ]) assert.throws(() => validateBootstrapSelection(bad, {
    selectionArtifactId: 8442115507,
    headSha: value.terminalDevelopSha,
    originDevelopSha: value.terminalDevelopSha,
    ...context,
  }), new RegExp(label.split(" ")[0], "i"));

  const forged = selection();
  forged.f11Digest = DIGEST("9");
  assert.throws(() => validateBootstrapSelection(forged, {
    selectionArtifactId: 8442115507,
    headSha: forged.terminalDevelopSha,
    originDevelopSha: forged.terminalDevelopSha,
  }), /selection digest/i);
});

test("G02-A02 seals F7, F9 and F11 in strict chronological digest order", () => {
  const selected = selection();
  const f7 = buildGoalEvidence({
    selection: selected,
    selectionArtifactId: 8442115507,
    sourceBranch: "feature/2.5.0-g02-autonomous-ci-foundation",
    sourceSha: SHA("6"),
    baseSha: selected.terminalDevelopSha,
    producerRun: { id: 201, runAttempt: 1, repository: "dazeGG/VoiceRoom", event: "pull_request", headSha: SHA("6") },
    requiredGates: ["Lint, typecheck & build", "Tests", "G02 autonomous clean-stack verification"],
    verification: { chromiumRuns: 2, retries: 0, teardown: "passed", reportDigest: DIGEST("7") },
    createdAt: instant(10),
  });
  const reviews = authenticatedReviews(f7);
  const f9 = buildApprovalEnvelope(f7, reviews, instant(20));
  const f11 = buildMergeEnvelope(f7, f9, {
    mergeSha: SHA("8"), terminalDevelopSha: SHA("8"), remoteDeleted: true,
    prNumber: 42, mergedAt: instant(21), remoteDeletionObservedAt: instant(22),
    postMergeRun: { id: 301, runAttempt: 1, repository: "dazeGG/VoiceRoom", event: "push", headSha: SHA("8") },
    createdAt: instant(23),
  });
  assert.equal(f9.f7Digest, f7.digest);
  assert.equal(f11.f7Digest, f7.digest);
  assert.equal(f11.f9Digest, f9.digest);
  assert.equal(f11.remoteDeleted, true);
  assert.equal(f11.terminalDevelopSha, f11.mergeSha);
  assert.throws(() => buildApprovalEnvelope(f7, reviews.slice(0, 2), instant(20)), /three reviews/i);
  assert.throws(() => buildMergeEnvelope(f7, f9, { ...f11, remoteDeleted: false }), /remote deletion/i);
});

test("G02-A02 rejects outsider/forged review comments and requires verifier parent provenance", () => {
  const selected = selection();
  const f7 = buildGoalEvidence({
    selection: selected,
    selectionArtifactId: 8442115507,
    sourceBranch: "feature/2.5.0-g02-autonomous-ci-foundation",
    sourceSha: SHA("6"),
    baseSha: selected.terminalDevelopSha,
    producerRun: { id: 201, runAttempt: 1, repository: "dazeGG/VoiceRoom", event: "pull_request", headSha: SHA("6") },
    requiredGates: ["Lint, typecheck & build", "Tests", "G02 autonomous clean-stack verification"],
    verification: { chromiumRuns: 2, retries: 0, teardown: "passed", reportDigest: DIGEST("7") },
    createdAt: instant(10),
  });
  const reviews = authenticatedReviews(f7);
  const comments = reviews.map((review) => ({
    id: review.commentId,
    node_id: review.nodeId,
    user: { id: review.actorId, type: "User" },
    author_association: review.authorAssociation,
    created_at: review.createdAt,
    updated_at: review.createdAt,
    body: buildReviewComment(Object.fromEntries(Object.entries(review).filter(([key]) => !["outputDigest", "commentId", "nodeId", "actorId", "authorAssociation", "createdAt"].includes(key)))),
  }));
  const authority = {
    repository: "dazeGG/VoiceRoom",
    pr: { number: 42, state: "open", head: { sha: f7.sourceSha, ref: f7.sourceBranch, repo: { full_name: "dazeGG/VoiceRoom" } }, base: { ref: "develop", repo: { full_name: "dazeGG/VoiceRoom" } } },
    comments,
    transportActorId: 1001,
    f7Artifact: { id: 91, name: reviews[0].f7ArtifactName, archiveDigest: reviews[0].f7ArchiveDigest, payloadDigest: reviews[0].f7PayloadDigest },
    observedAt: instant(20),
  };
  assert.equal(buildApprovalEnvelopeFromAuthority(f7, authority).reviewObjects.length, 3);
  assert.throws(() => buildApprovalEnvelopeFromAuthority(f7, { ...authority, comments: comments.map((comment, index) => index ? comment : { ...comment, user: { id: 9999, type: "User" } }) }), /code-reviewer/i);
  const forged = structuredClone(comments); forged[2].body = forged[2].body.replace(reviews[0].outputDigest, DIGEST("0"));
  assert.throws(() => buildApprovalEnvelopeFromAuthority(f7, { ...authority, comments: forged }), /parent|verifier/i);
});

test("G02-A01 recomputes artifact archive, payload and phase digests against selection bindings", () => {
  const selected = selection();
  const report = { registry: "authenticated" };
  const f7 = {
    schemaVersion: 1, goal: "G01", phase: "F7", status: "GREEN", evidenceId: selected.f7Id,
    attemptId: selected.attemptId, sourceBranch: "feature/g01", sourceSha: selected.artifactBindings.f7.headSha,
    baseSha: SHA("e"), producerRun: { id: 11 }, requiredGates: ["test"], verification: { passed: true }, createdAt: instant(2),
  };
  f7.digest = compactDigest({ candidateReport: report, baseSha: f7.baseSha, sourceSha: f7.sourceSha, producerRun: f7.producerRun, requiredGates: f7.requiredGates, verification: f7.verification });
  const f9 = { schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: selected.f9Id, attemptId: selected.attemptId, sourceBranch: f7.sourceBranch, sourceSha: f7.sourceSha, f7Digest: f7.digest, reviewObjects: [{ authenticated: true }], createdAt: instant(3) };
  f9.digest = compactDigest(f9.reviewObjects);
  const postMergeRun = { id: 13, headSha: selected.terminalDevelopSha };
  const f11 = { schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: selected.f11Id, attemptId: selected.attemptId, sourceBranch: f7.sourceBranch, sourceSha: selected.terminalDevelopSha, f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: selected.terminalDevelopSha, terminalDevelopSha: selected.terminalDevelopSha, remoteDeleted: true, mergedAt: instant(4), remoteDeletionObservedAt: instant(5), prNumber: 42, postMergeRun, createdAt: instant(6) };
  f11.digest = compactDigest({ prNumber: f11.prNumber, mergeSha: f11.mergeSha, postMergeRun });
  const envelopes = { f7, f9, f11 };
  const downloads = {};
  for (const phase of ["f7", "f9", "f11"]) {
    const payloadBytes = Buffer.from(`${JSON.stringify(envelopes[phase])}\n`);
    const archiveBytes = Buffer.from(`archive-${phase}`);
    const binding = selected.artifactBindings[phase];
    Object.assign(binding, { archiveDigest: `sha256:${crypto.createHash("sha256").update(archiveBytes).digest("hex")}`, payloadDigest: `sha256:${crypto.createHash("sha256").update(payloadBytes).digest("hex")}` });
    downloads[phase] = {
      metadata: { id: binding.artifactId, name: binding.artifactName, digest: binding.archiveDigest, expired: false, workflow_run: { id: binding.runId, head_sha: binding.headSha } },
      run: { id: binding.runId, run_attempt: binding.runAttempt, head_sha: binding.headSha, event: phase === "f11" ? "push" : "pull_request", path: ".github/workflows/ci.yml", repository: { full_name: "dazeGG/VoiceRoom" }, status: "completed", conclusion: "success" },
      archiveBytes,
      payloadBytes,
      ...(phase === "f7" ? { candidateReport: report } : {}),
    };
  }
  selected.f7Digest = f7.digest; selected.f9Digest = f9.digest; selected.f11Digest = f11.digest;
  selected.selectionDigest = compactDigest(Object.fromEntries(Object.entries(selected).filter(([key]) => key !== "selectionDigest")));
  assert.equal(validateArtifactDownloads(selected, envelopes, downloads, "dazeGG/VoiceRoom").f11.digest, f11.digest);
  const tampered = { ...downloads, f9: { ...downloads.f9, payloadBytes: Buffer.from("{}\n") } };
  assert.throws(() => validateArtifactDownloads(selected, envelopes, tampered, "dazeGG/VoiceRoom"), /payload digest/i);
});

test("workflow owns an isolated clean stack, two retry-free Chromium runs and always tears down", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const compose = fs.readFileSync("docker-compose.ci.yml", "utf8");
  const playwright = fs.readFileSync("apps/web/playwright.config.ts", "utf8");
  assert.match(workflow, /^  goal-g02:/m);
  assert.match(workflow, /^      BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}$/m);
  assert.doesNotMatch(workflow.match(/^  bootstrap-plan:[\s\S]*?(?=^  [a-z])/m)?.[0] ?? "", /BASE_SHA:/);
  assert.match(workflow, /name: G02 autonomous clean-stack verification/);
  assert.equal((workflow.match(/npm --workspace @voice-room\/web run e2e -- --project=chromium --retries=0/g) ?? []).length, 2);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /docker compose -f docker-compose\.ci\.yml down --volumes --remove-orphans/);
  assert.match(workflow, /bootstrap-selection\.g01-recovery-a27\.json/);
  assert.doesNotMatch(workflow, /bootstrap-lineage\.json/);
  assert.match(compose, /^name: voiceroom-g02-ci$/m);
  assert.match(compose, /tmpfs:/);
  assert.match(compose, /condition: service_healthy/);
  assert.doesNotMatch(compose, /restart:/);
  assert.match(playwright, /retries:\s*0/);
  assert.match(playwright, /trace:\s*'retain-on-failure'/);
});

test("evidence digests are compact SHA-256 values", () => {
  const value = { b: 2, a: 1 };
  assert.equal(compactDigest(value), `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`);
});
