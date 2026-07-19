#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { compactDigest } from "./export-goal-evidence.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const ROLES = ["code-reviewer", "architect", "verifier"];
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const REVIEW_MARKER = "<!-- voiceroom:g02-native-review:v1 -->";
const MAX_OUTPUT_BYTES = 48_000;
const REVIEW_INPUT_KEYS = [
  "schemaVersion", "kind", "role", "verdict", "repository", "prNumber", "headSha", "attemptId",
  "f7ArtifactId", "f7ArtifactName", "f7ArchiveDigest", "f7PayloadDigest", "f7Digest",
  "laneId", "output", "parentReferences",
];
const REVIEW_PAYLOAD_KEYS = [...REVIEW_INPUT_KEYS.slice(0, -1), "outputDigest", "parentReferences"];
const REVIEW_OBJECT_KEYS = [...REVIEW_PAYLOAD_KEYS, "commentId", "nodeId", "actorId", "authorAssociation", "createdAt"];

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys must be exact`);
}

function instant(value, label) {
  assert.equal(typeof value, "string", `${label} must be a timestamp`);
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, `${label} must be canonical UTC`);
  return parsed;
}

export function reviewOutputDigest(output) {
  return `sha256:${crypto.createHash("sha256").update(output).digest("hex")}`;
}

function validateParentReferences(role, references) {
  assert.ok(Array.isArray(references), `${role} parent references must be an array`);
  if (role !== "verifier") {
    assert.deepEqual(references, [], `${role} cannot declare parent references`);
    return;
  }
  assert.equal(references.length, 2, "verifier must bind both parent reviews");
  assert.deepEqual(references.map(({ role: parentRole }) => parentRole), ROLES.slice(0, 2), "verifier parent roles are invalid");
  for (const reference of references) {
    exactKeys(reference, ["role", "commentId", "outputDigest"], "verifier parent reference");
    assert.ok(Number.isInteger(reference.commentId) && reference.commentId > 0, "verifier parent comment is invalid");
    assert.match(reference.outputDigest, DIGEST, "verifier parent output digest is invalid");
  }
}

function validateReviewPayload(value) {
  exactKeys(value, REVIEW_PAYLOAD_KEYS, "native review payload");
  assert.equal(value.schemaVersion, 1); assert.equal(value.kind, "g02-native-review");
  assert.equal(ROLES.includes(value.role), true, "native review role is invalid");
  assert.equal(value.verdict, value.role === "architect" ? "CLEAR" : "APPROVE", "native review verdict is invalid");
  assert.match(value.repository, /^[^/]+\/[^/]+$/); assert.ok(Number.isInteger(value.prNumber) && value.prNumber > 0);
  assert.match(value.headSha, SHA); assert.equal(value.attemptId, "g02");
  assert.ok(Number.isInteger(value.f7ArtifactId) && value.f7ArtifactId > 0); assert.ok(value.f7ArtifactName.length > 0);
  for (const key of ["f7ArchiveDigest", "f7PayloadDigest", "f7Digest", "outputDigest"]) assert.match(value[key], DIGEST, `${key} is invalid`);
  assert.match(value.laneId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  assert.ok(typeof value.output === "string" && Buffer.byteLength(value.output) > 0 && Buffer.byteLength(value.output) <= MAX_OUTPUT_BYTES, "native review output is invalid");
  assert.equal(value.outputDigest, reviewOutputDigest(value.output), "native review output digest mismatch");
  validateParentReferences(value.role, value.parentReferences);
  return value;
}

export function buildReviewComment(input) {
  exactKeys(input, REVIEW_INPUT_KEYS, "native review input");
  const payload = validateReviewPayload({ ...input, outputDigest: reviewOutputDigest(input.output) });
  return `${REVIEW_MARKER}\n${JSON.stringify(payload)}`;
}

function parseReviewComment(body) {
  assert.equal(typeof body, "string");
  const prefix = `${REVIEW_MARKER}\n`;
  assert.ok(body.startsWith(prefix), "native review marker mismatch");
  assert.equal(body.indexOf("\n", prefix.length), -1, "native review body must be one canonical JSON line");
  const payload = validateReviewPayload(JSON.parse(body.slice(prefix.length)));
  assert.equal(buildReviewComment(Object.fromEntries(REVIEW_INPUT_KEYS.map((key) => [key, payload[key]]))), body, "native review body is not canonical");
  return payload;
}

function validateReviewObjects(f7, reviews, createdAt) {
  assert.ok(Array.isArray(reviews) && reviews.length === 3, "exactly three reviews are required");
  assert.deepEqual(reviews.map(({ role }) => role), ROLES);
  const ids = new Set(); const nodes = new Set(); const lanes = new Set(); const outputs = new Set(); const actors = new Set();
  for (const review of reviews) {
    exactKeys(review, REVIEW_OBJECT_KEYS, `${review.role} review`);
    validateReviewPayload(Object.fromEntries(REVIEW_PAYLOAD_KEYS.map((key) => [key, review[key]])));
    assert.equal(review.headSha, f7.sourceSha); assert.equal(review.attemptId, f7.attemptId); assert.equal(review.f7Digest, f7.digest);
    assert.ok(Number.isInteger(review.commentId) && review.commentId > 0 && !ids.has(review.commentId)); ids.add(review.commentId);
    assert.ok(typeof review.nodeId === "string" && review.nodeId && !nodes.has(review.nodeId)); nodes.add(review.nodeId);
    assert.ok(Number.isInteger(review.actorId) && review.actorId > 0); actors.add(review.actorId);
    assert.ok(TRUSTED_ASSOCIATIONS.has(review.authorAssociation), `${review.role} author association is untrusted`);
    assert.ok(!lanes.has(review.laneId)); lanes.add(review.laneId); assert.ok(!outputs.has(review.outputDigest)); outputs.add(review.outputDigest);
    assert.ok(instant(f7.createdAt, "F7 createdAt") < instant(review.createdAt, `${review.role} createdAt`));
    assert.ok(instant(review.createdAt, `${review.role} createdAt`) < instant(createdAt, "F9 createdAt"), "F9 must follow every review");
  }
  assert.equal(actors.size, 1, "reviews must use one configured transport actor");
  const parents = reviews.slice(0, 2);
  assert.ok(parents.every((review) => instant(review.createdAt, `${review.role} createdAt`) < instant(reviews[2].createdAt, "verifier createdAt")), "verifier must follow parent reviews");
  assert.deepEqual(reviews[2].parentReferences, parents.map(({ role, commentId, outputDigest }) => ({ role, commentId, outputDigest })), "verifier parent references do not bind exact reviews");
  return reviews;
}

export function buildApprovalEnvelope(f7, reviews, createdAt) {
  assert.equal(f7.goal, "G02"); assert.equal(f7.phase, "F7"); assert.equal(f7.status, "GREEN");
  validateReviewObjects(f7, reviews, createdAt);
  const core = {
    schemaVersion: 1, goal: "G02", phase: "F9", status: "GREEN",
    evidenceId: "approval-envelope.g02.json", attemptId: f7.attemptId,
    sourceBranch: f7.sourceBranch, sourceSha: f7.sourceSha, f7Digest: f7.digest,
    reviewObjects: reviews, createdAt,
  };
  return { ...core, digest: compactDigest(core) };
}

export function buildApprovalEnvelopeFromAuthority(f7, authority) {
  assert.equal(authority.pr?.state, "open"); assert.ok(Number.isInteger(authority.pr?.number) && authority.pr.number > 0);
  assert.equal(authority.pr?.head?.sha, f7.sourceSha); assert.equal(authority.pr?.head?.ref, f7.sourceBranch);
  assert.equal(authority.pr?.head?.repo?.full_name, authority.repository); assert.equal(authority.pr?.base?.repo?.full_name, authority.repository); assert.equal(authority.pr?.base?.ref, "develop");
  assert.ok(Number.isInteger(authority.transportActorId) && authority.transportActorId > 0, "configured transport actor is invalid");
  assert.ok(Array.isArray(authority.comments));
  assert.ok(Number.isInteger(authority.f7Artifact?.id) && authority.f7Artifact.id > 0, "F7 artifact id is invalid");
  assert.equal(authority.f7Artifact?.name, `g02-candidate-g02-run-${f7.producerRun.id}-attempt-${f7.producerRun.runAttempt}-head-${f7.sourceSha}`, "F7 artifact name mismatch");
  assert.match(authority.f7Artifact?.archiveDigest, DIGEST); assert.match(authority.f7Artifact?.payloadDigest, DIGEST);
  const f7Core = { ...f7 }; delete f7Core.digest;
  assert.equal(f7.digest, compactDigest(f7Core), "F7 core digest mismatch");
  const identity = {
    repository: authority.repository, prNumber: authority.pr.number, headSha: f7.sourceSha, attemptId: f7.attemptId,
    f7ArtifactId: authority.f7Artifact.id, f7ArtifactName: authority.f7Artifact.name,
    f7ArchiveDigest: authority.f7Artifact.archiveDigest, f7PayloadDigest: authority.f7Artifact.payloadDigest, f7Digest: f7.digest,
  };
  const candidates = [];
  for (const comment of authority.comments) {
    if (typeof comment.body !== "string" || !comment.body.startsWith(REVIEW_MARKER)) continue;
    if (comment.user?.id !== authority.transportActorId || comment.user?.type !== "User" || !TRUSTED_ASSOCIATIONS.has(comment.author_association)) continue;
    const payload = parseReviewComment(comment.body);
    if (Object.entries(identity).some(([key, expected]) => payload[key] !== expected)) continue;
    assert.equal(comment.created_at, comment.updated_at, `${payload.role} comment was edited`);
    candidates.push({ ...payload, commentId: comment.id, nodeId: comment.node_id, actorId: comment.user.id, authorAssociation: comment.author_association, createdAt: new Date(Date.parse(comment.created_at)).toISOString() });
  }
  const reviews = ROLES.map((role) => {
    const matches = candidates.filter((review) => review.role === role);
    assert.equal(matches.length, 1, `exact authenticated ${role} review absent or ambiguous`);
    return matches[0];
  });
  return buildApprovalEnvelope(f7, reviews, authority.observedAt);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const f7 = JSON.parse(fs.readFileSync(arg("--f7"))); const authority = JSON.parse(fs.readFileSync(arg("--authority")));
  fs.writeFileSync(arg("--output"), `${JSON.stringify(buildApprovalEnvelopeFromAuthority(f7, authority))}\n`);
}
