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
const REVIEW_LANES = [["code-reviewer", "APPROVE"], ["architect", "CLEAR"], ["verifier", "APPROVE"]];
const REVIEW_COMMENT_MARKER = "<!-- voiceroom:g01-native-review:v1 -->";
const MAX_REVIEW_OUTPUT_BYTES = 48000;
const MAX_GITHUB_COMMENT_BYTES = 65536;
const REVIEW_IDENTITY_FIELDS = ["repository", "prNumber", "headSha", "attemptId", "f7ArtifactId", "f7ArtifactName", "f7ArchiveDigest", "f7PayloadDigest", "f7Digest"];
const REVIEW_INPUT_FIELDS = ["schemaVersion", "kind", "role", "verdict", "repository", "prNumber", "headSha", "attemptId", "f7ArtifactId", "f7ArtifactName", "f7ArchiveDigest", "f7PayloadDigest", "f7Digest", "laneId", "output", "parentReferences"];
const REVIEW_PAYLOAD_FIELDS = [...REVIEW_INPUT_FIELDS.slice(0, -1), "outputDigest", "parentReferences"];

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

function authenticatedGitHubInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be a timestamp`);
  assert.match(value, /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i, `${label} must include a timezone`);
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `${label} must be a valid timestamp`);
  return instant(new Date(parsed).toISOString(), label);
}

function authenticateMergedPullRequest(pr, expectedMergeSha, label = "PR") {
  assert.equal(pr?.state, "closed", `${label} must be closed`);
  if (Object.hasOwn(pr, "merged")) assert.equal(pr.merged, true, `${label} merged flag must be true when present`);
  const mergedAt = authenticatedGitHubInstant(pr?.merged_at, `${label} merged_at`);
  assert.equal(pr?.merge_commit_sha, expectedMergeSha, `${label} merge SHA mismatch`);
  return mergedAt;
}

function compactDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
export function validateArtifactlessBackfillAuthority(value, failure) {
  exactKeys(value, ["schemaVersion", "kind", "repository", "attemptId", "evidenceId", "failedPhase", "failurePayloadDigest", "subjectRun", "subjectPr", "subjectJobs", "failedJobLogDigest", "checkRuns", "f7Artifact", "f9Artifact", "absenceCapture", "producer", "createdAt", "digest"], "artifactless backfill authority");
  const core = { ...value }; delete core.digest; assert.equal(value.digest, compactDigest(core)); assert.equal(value.schemaVersion, 1); assert.equal(value.kind, "g01-artifactless-run-backfill"); assert.match(value.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.equal(value.attemptId, failure.attemptId); assert.equal(value.evidenceId, failure.evidenceId); assert.equal(value.failedPhase, failure.failedPhase); assert.equal(value.failurePayloadDigest, envelopePayloadDigest(failure)); instant(value.createdAt, "backfill createdAt");
  const run=value.subjectRun; exactKeys(run,["id","runAttempt","workflowId","checkSuiteId","workflowName","workflowPath","repository","event","headBranch","headSha","status","conclusion"],"backfill subject run"); assert.equal(run.id,failure.runId);assert.equal(run.runAttempt,failure.runAttempt);assert.equal(run.workflowName,WORKFLOW_NAME);assert.equal(run.workflowPath,WORKFLOW_PATH);assert.equal(run.repository,value.repository);assert.equal(run.event,"push");assert.equal(run.headBranch,"develop");assert.equal(run.headSha,failure.terminalDevelopSha);assert.equal(run.status,"completed");assert.ok(run.conclusion&&run.conclusion!=="success");
  const pr=value.subjectPr; exactKeys(pr,["id","number","nodeId","state","headSha","headBranch","baseSha","mergeSha","mergedAt"],"backfill subject PR");assert.ok(Number.isInteger(pr.id)&&pr.id>0);assert.ok(Number.isInteger(pr.number)&&pr.number>0);assert.equal(pr.state,"closed");assert.equal(pr.headSha,failure.headSha);assert.equal(pr.baseSha,failure.baseSha);assert.equal(pr.mergeSha,failure.terminalDevelopSha);authenticatedGitHubInstant(pr.mergedAt,"backfill subject mergedAt");
  const subjectJobNames=["Lint, typecheck & build","Tests","G01 authenticated post-merge F11"];
  assert.deepEqual(value.subjectJobs.map(({name})=>name),subjectJobNames);for(const [i,j] of value.subjectJobs.entries()){exactKeys(j,["id","name","status","conclusion"],`backfill subject job ${i}`);assert.ok(Number.isInteger(j.id)&&j.id>0);assert.equal(j.status,"completed")}assert.deepEqual(value.subjectJobs.map(({conclusion})=>conclusion),["success","success","failure"]);assert.match(value.failedJobLogDigest,DIGEST);
  assert.ok(Array.isArray(value.checkRuns)&&value.checkRuns.length===3);assert.deepEqual(value.checkRuns.map(({name})=>name),subjectJobNames);assert.deepEqual(value.checkRuns.map(({conclusion})=>conclusion),["success","success","failure"]);for(const [i,x] of value.checkRuns.entries()){exactKeys(x,["id","name","status","conclusion","detailsUrl","checkSuiteId"],`backfill check ${i}`);assert.ok(Number.isInteger(x.id)&&x.id>0);assert.equal(x.status,"completed");assert.equal(x.checkSuiteId,run.checkSuiteId);assert.match(x.detailsUrl,/^https:\/\//)}assert.equal(new Set(value.checkRuns.map(({id})=>id)).size,3);
  for(const [a,phase] of [[value.f7Artifact,"candidate"],[value.f9Artifact,"approval"]]){exactKeys(a,["id","name","archiveDigest","payloadDigest","runId","runAttempt","headSha"],`backfill ${phase}`);assert.ok(Number.isInteger(a.id)&&a.id>0);assert.match(a.archiveDigest,DIGEST);assert.match(a.payloadDigest,DIGEST);assert.equal(a.headSha,failure.headSha);assert.match(a.name,new RegExp(`^g01-${phase}-${failure.attemptId}-run-${a.runId}-attempt-${a.runAttempt}-head-${failure.headSha}$`))}assert.equal(value.f7Artifact.runId,value.f9Artifact.runId);assert.equal(value.f7Artifact.runAttempt,value.f9Artifact.runAttempt);
  exactKeys(value.absenceCapture,["observedAt","pageDigests","paginationEndMarker","matchingArtifactIds"],"backfill absence capture");authenticatedGitHubInstant(value.absenceCapture.observedAt,"backfill absence observedAt");assert.ok(Array.isArray(value.absenceCapture.pageDigests)&&value.absenceCapture.pageDigests.length>0);value.absenceCapture.pageDigests.forEach(x=>assert.match(x,DIGEST));assert.equal(value.absenceCapture.paginationEndMarker,"gh-api--paginate-completed-no-next-page");assert.deepEqual(value.absenceCapture.matchingArtifactIds,[]);
  const p=value.producer;exactKeys(p,["runId","runAttempt","workflowId","checkSuiteId","headSha","headBranch","event","workflowName","workflowPath","jobId","jobName"],"backfill producer");for(const key of ["runId","runAttempt","workflowId","checkSuiteId","jobId"])assert.ok(Number.isInteger(p[key])&&p[key]>0);assert.notEqual(p.runId,run.id);assert.equal(p.event,"pull_request");assert.equal(p.workflowName,WORKFLOW_NAME);assert.equal(p.workflowPath,WORKFLOW_PATH);assert.equal(p.headBranch,"feature/g01-artifactless-backfill");assert.equal(p.jobName,"G01 authenticated artifactless failure backfill");assert.match(p.headSha,SHA);
  return value;
}
function f7AuthorityDigest(f7, candidateReport) {
  return compactDigest({ candidateReport, baseSha: f7.baseSha, sourceSha: f7.sourceSha, producerRun: f7.producerRun, requiredGates: f7.requiredGates, verification: f7.verification });
}

function nativeOutputDigest(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }

function validateParentReferences(role, references) {
  assert.ok(Array.isArray(references), "native review parentReferences must be an array");
  if (role !== "verifier") { assert.deepEqual(references, [], `${role} cannot declare parent references`); return references; }
  assert.equal(references.length, 2, "verifier must bind both native parent lanes");
  assert.deepEqual(references.map(({ role: parentRole }) => parentRole), ["code-reviewer", "architect"], "verifier parent references must be ordered");
  for (const [index, reference] of references.entries()) {
    exactKeys(reference, ["role", "commentId", "outputDigest"], `verifier parent reference ${index}`);
    assert.ok(Number.isInteger(reference.commentId) && reference.commentId > 0, "verifier parent comment ID is invalid");
    assert.match(reference.outputDigest, DIGEST, "verifier parent output digest is invalid");
  }
  return references;
}

function validateReviewPayload(payload) {
  exactKeys(payload, REVIEW_PAYLOAD_FIELDS, "native review comment payload");
  assert.equal(payload.schemaVersion, 1); assert.equal(payload.kind, "g01-native-review");
  assert.equal(REVIEW_LANES.find(([role]) => role === payload.role)?.[1], payload.verdict, "native review lane/verdict mismatch");
  assert.match(payload.repository, /^[^/]+\/[^/]+$/); assert.ok(Number.isInteger(payload.prNumber) && payload.prNumber > 0);
  assert.match(payload.headSha, SHA); assert.match(payload.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/);
  assert.ok(Number.isInteger(payload.f7ArtifactId) && payload.f7ArtifactId > 0); assert.ok(typeof payload.f7ArtifactName === "string" && payload.f7ArtifactName.length > 0);
  for (const key of ["f7ArchiveDigest", "f7PayloadDigest", "f7Digest", "outputDigest"]) assert.match(payload[key], DIGEST, `${key} is invalid`);
  assert.match(payload.laneId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "native review laneId is invalid");
  assert.ok(typeof payload.output === "string" && payload.output.length > 0 && Buffer.byteLength(payload.output) <= MAX_REVIEW_OUTPUT_BYTES, "native review output is invalid");
  assert.equal(payload.outputDigest, nativeOutputDigest(payload.output), "native review output digest mismatch");
  validateParentReferences(payload.role, payload.parentReferences);
  return payload;
}

export function buildReviewComment(input) {
  exactKeys(input, REVIEW_INPUT_FIELDS, "native review comment input");
  const payload = validateReviewPayload({ ...Object.fromEntries(REVIEW_INPUT_FIELDS.slice(0, -1).map((key) => [key, input[key]])), outputDigest: nativeOutputDigest(input.output), parentReferences: input.parentReferences });
  const body = `${REVIEW_COMMENT_MARKER}\n${JSON.stringify(payload)}`;
  assert.ok(Buffer.byteLength(body) <= MAX_GITHUB_COMMENT_BYTES, "serialized native review comment exceeds GitHub limit");
  return body;
}

export function parseReviewComment(body) {
  assert.equal(typeof body, "string", "native review comment body must be a string");
  const prefix = `${REVIEW_COMMENT_MARKER}\n`; assert.ok(body.startsWith(prefix), "native review comment marker mismatch");
  assert.equal(body.indexOf("\n", prefix.length), -1, "native review comment must contain one canonical JSON line");
  const payload = validateReviewPayload(JSON.parse(body.slice(prefix.length)));
  const input = Object.fromEntries(REVIEW_INPUT_FIELDS.map((key) => [key, payload[key]]));
  assert.equal(buildReviewComment(input), body, "native review comment body is not canonical");
  return payload;
}

export function buildReviewCommentFromFiles({ identityPath, role, laneId, reportPath, parentsPath }) {
  const identity = JSON.parse(fs.readFileSync(identityPath, "utf8")); exactKeys(identity, REVIEW_IDENTITY_FIELDS, "native review F7 identity");
  const verdict = REVIEW_LANES.find(([candidate]) => candidate === role)?.[1]; assert.ok(verdict, "native review role is invalid");
  const reportBytes = fs.readFileSync(reportPath); assert.ok(reportBytes.length > 0 && reportBytes.length <= MAX_REVIEW_OUTPUT_BYTES, "native review report size is invalid");
  const output = new TextDecoder("utf-8", { fatal: true }).decode(reportBytes);
  const parentReferences = parentsPath ? JSON.parse(fs.readFileSync(parentsPath, "utf8")) : [];
  return buildReviewComment({ schemaVersion: 1, kind: "g01-native-review", role, verdict, ...identity, laneId, output, parentReferences });
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
  assert.ok(authenticatedGitHubInstant(metadata.expires_at, `${label} artifact expires_at`) > instant(expected.observedAt, `${label} observedAt`), `${label} artifact is not live at observation`);
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

function normalizeReviews(authority, f7) {
  assert.ok(Number.isInteger(authority.transportActorId) && authority.transportActorId > 0, "configured review transport actor ID is invalid");
  assert.ok(Array.isArray(authority.comments), "GitHub issue comments response must be an array");
  const expectedIdentity = { repository: authority.repository, prNumber: authority.pr.number, headSha: f7.sourceSha, attemptId: f7.attemptId, f7ArtifactId: authority.f7Artifact.metadata.id, f7ArtifactName: authority.f7Artifact.metadata.name, f7ArchiveDigest: authority.f7Artifact.metadata.digest, f7PayloadDigest: authority.f7Artifact.payloadDigest, f7Digest: f7.digest };
  const candidates = [];
  for (const comment of authority.comments) {
    if (typeof comment.body !== "string" || !comment.body.startsWith(REVIEW_COMMENT_MARKER)) continue;
    if (comment.user?.id !== authority.transportActorId || !TRUSTED_ASSOCIATIONS.has(comment.author_association)) continue;
    const payload = parseReviewComment(comment.body);
    if (payload.repository !== authority.repository || payload.prNumber !== authority.pr.number || payload.headSha !== f7.sourceSha || payload.attemptId !== f7.attemptId) continue;
    if (Object.entries(expectedIdentity).some(([key, expected]) => payload[key] !== expected)) continue;
    assert.equal(comment.user?.id, authority.transportActorId, `${payload.role} comment actor is not the configured transport actor`);
    assert.ok(TRUSTED_ASSOCIATIONS.has(comment.author_association), `${payload.role} comment actor association is untrusted`);
    assert.equal(comment.created_at, comment.updated_at, `${payload.role} comment must remain immutable`);
    assert.ok(Number.isInteger(comment.id) && comment.id > 0, `${payload.role} comment ID is invalid`);
    assert.ok(typeof comment.node_id === "string" && comment.node_id.length > 0, `${payload.role} comment node ID is invalid`);
    const createdAt = authenticatedGitHubInstant(comment.created_at, `${payload.role} comment created_at`);
    candidates.push({ comment, payload, createdAt });
  }
  const normalized = REVIEW_LANES.map(([role, verdict]) => {
    const matches = candidates.filter(({ payload }) => payload.role === role && payload.verdict === verdict);
    assert.equal(matches.length, 1, `expected exactly one valid current-head comment for native ${role} lane`);
    const { comment, payload, createdAt } = matches[0];
    assert.ok(instant(f7.createdAt, "F7.createdAt") < createdAt, `${role} comment must follow F7`);
    return { ...payload, commentId: comment.id, nodeId: comment.node_id, actorId: comment.user.id, authorAssociation: comment.author_association, createdAt: new Date(createdAt).toISOString() };
  });
  assert.equal(new Set(normalized.map(({ commentId }) => commentId)).size, 3, "native review comment IDs must be distinct");
  assert.equal(new Set(normalized.map(({ nodeId }) => nodeId)).size, 3, "native review comment node IDs must be distinct");
  assert.equal(new Set(normalized.map(({ actorId }) => actorId)).size, 1, "native review comments must use one configured transport actor");
  assert.equal(new Set(normalized.map(({ laneId }) => laneId)).size, 3, "native review lane IDs must be distinct");
  assert.equal(new Set(normalized.map(({ outputDigest: digest }) => digest)).size, 3, "native review output digests must be distinct");
  const byRole = new Map(normalized.map((review) => [review.role, review]));
  const verifier = byRole.get("verifier"), verifierAt = instant(verifier.createdAt, "verifier comment created_at");
  assert.ok(instant(byRole.get("code-reviewer").createdAt, "code-reviewer comment created_at") < verifierAt, "verifier approval must follow code-reviewer approval");
  assert.ok(instant(byRole.get("architect").createdAt, "architect comment created_at") < verifierAt, "verifier approval must follow architect clearance");
  assert.deepEqual(verifier.parentReferences, ["code-reviewer", "architect"].map((role) => ({ role, commentId: byRole.get(role).commentId, outputDigest: byRole.get(role).outputDigest })), "verifier parent references do not bind the exact native parent lanes");
  return normalized;
}

export function buildF9Envelope(f7, authority) {
  validateEnvelope(f7, "F7");
  exactKeys(authority, ["pr", "comments", "transportActorId", "observedAt", "repository", "f7Artifact", "candidateReport", "premergeAncestorArtifacts"], "approval authority");
  assert.ok(Array.isArray(authority.premergeAncestorArtifacts), "F9 requires the premerge ancestor authentication catalog");
  for (const [index, ancestor] of authority.premergeAncestorArtifacts.entries()) {
    exactKeys(ancestor, ["evidenceId", "attemptId", "payloadDigest", "artifactId", "artifactName", "archiveDigest", "downloadDigest", "runId", "runAttempt", "headSha", "terminalDevelopSha", ...(ancestor.provenance ? ["provenance"] : [])], `premerge ancestor ${index}`);
    assert.equal(ancestor.archiveDigest, ancestor.downloadDigest, "premerge ancestor archive digest mismatch");
    assert.match(ancestor.evidenceId, /^bootstrap-failure\.g01-(?:a|recovery-a)[0-9]{2,}\.json$/);
    assert.equal(ancestor.evidenceId, `bootstrap-failure.${ancestor.attemptId}.json`);
    assert.match(ancestor.payloadDigest, DIGEST); assert.match(ancestor.archiveDigest, DIGEST);
    if (ancestor.provenance) {
      exactKeys(ancestor.provenance, ["kind", "authorityDigest", "producerRunId", "producerRunAttempt", "producerHeadSha", "recoveryTerminalDevelopSha", "subjectTerminalDevelopSha"], `premerge ancestor ${index} provenance`);
      assert.equal(ancestor.provenance.kind, "artifactless-run-backfill"); assert.match(ancestor.provenance.authorityDigest, DIGEST);
      assert.match(ancestor.provenance.producerHeadSha, SHA); assert.match(ancestor.provenance.subjectTerminalDevelopSha, SHA);
      assert.equal(ancestor.provenance.recoveryTerminalDevelopSha, ancestor.terminalDevelopSha); assert.notEqual(ancestor.provenance.producerRunId, ancestor.runId);
    }
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
  assert.equal(f7.digest, f7AuthorityDigest(f7, authority.candidateReport), "F7 digest must bind the authenticated candidate report, repository gates and verification catalog");
  const reviewObjects = normalizeReviews(authority, f7);
  const createdAt = authority.observedAt; instant(createdAt, "approval observedAt");
  assert.ok(instant(f7.createdAt, "F7.createdAt") < instant(createdAt, "approval observedAt"), "F9 must follow F7");
  assert.ok(reviewObjects.every(({ createdAt: reviewedAt }) => instant(reviewedAt, "review createdAt") < instant(createdAt, "approval observedAt")), "F9 must follow every review");
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: `approval-envelope.${identity.suffix}`, attemptId: identity.attemptId, sourceBranch: f7.sourceBranch, sourceSha: f7.sourceSha, digest: compactDigest(reviewObjects), createdAt, f7Digest: f7.digest, reviewObjects }, "F9");
}

export function validateFallbackCandidatePair(f7, f9, candidateReport, authority) {
  validateEnvelope(f7, "F7"); validateEnvelope(f9, "F9");
  exactKeys(authority, ["repository", "observedAt", "f7Artifact", "f9Artifact"], "fallback candidate authority");
  const identity = resolveCandidateIdentity(candidateReport, f7.sourceBranch, f7.sourceSha);
  assert.equal(identity.attemptId, f7.attemptId); assert.equal(f9.attemptId, f7.attemptId); assert.equal(f9.sourceBranch, f7.sourceBranch); assert.equal(f9.sourceSha, f7.sourceSha); assert.equal(f9.f7Digest, f7.digest);
  assert.equal(f7.digest, f7AuthorityDigest(f7, candidateReport), "fallback F7 must bind the authenticated candidate report, repository gates and verification catalog");
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
  const mergedAtInstant = authenticateMergedPullRequest(authority.pr, authority.developRef.object?.sha);
  assert.equal(authority.pr.base?.ref, "develop");
  assert.equal(authority.pr.base?.repo?.full_name, authority.repository); assert.equal(authority.pr.head?.repo?.full_name, authority.repository);
  assert.equal(authority.pr.head?.sha, f7.sourceSha); assert.equal(authority.pr.head?.ref, f7.sourceBranch);
  assert.equal(authority.sourceRefStatus, 404, "remote source branch must return GitHub API 404");
  const postMergeRun = validatePostMergeRun(authority.postMergeRun, { repository: authority.repository, mergeSha: authority.pr.merge_commit_sha });
  for (const [artifactAuthority, envelope, name, label] of [
    [authority.f7Artifact, f7, artifactName("candidate", f7, authority.f7Artifact.run.id, authority.f7Artifact.run.run_attempt), "F7"],
    [authority.f9Artifact, f9, artifactName("approval", f9, authority.f9Artifact.run.id, authority.f9Artifact.run.run_attempt), "F9"],
  ]) validateArtifactAuthority(artifactAuthority, { name, headSha: f7.sourceSha, headBranch: f7.sourceBranch, event: "pull_request", repository: authority.repository, observedAt: authority.observedAt, completed: true, payload: envelope }, label);
  assert.equal(authority.f7Artifact.run.id, authority.f9Artifact.run.id, "F7/F9 must come from one premerge workflow run");
  assert.equal(authority.f7Artifact.run.run_attempt, authority.f9Artifact.run.run_attempt, "F7/F9 run attempt mismatch");
  const mergedAt = new Date(mergedAtInstant).toISOString(); const createdAt = authority.observedAt;
  instant(createdAt, "merge observedAt");
  assert.ok(instant(f9.createdAt, "F9.createdAt") < mergedAtInstant, "actual merge must follow F9");
  const payload = { prNumber: authority.pr.number, mergeSha: authority.pr.merge_commit_sha, postMergeRun };
  return validateEnvelope({ schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: f7.evidenceId.replace("ci-bundle", "merge-envelope"), attemptId: f7.attemptId, sourceBranch: f7.sourceBranch, sourceSha: authority.pr.merge_commit_sha, digest: compactDigest(payload), createdAt, f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: authority.pr.merge_commit_sha, terminalDevelopSha: authority.pr.merge_commit_sha, remoteDeleted: true, mergedAt, remoteDeletionObservedAt: createdAt, prNumber: authority.pr.number, postMergeRun }, "F11");
}

function validateAncestorFailures(value) {
  assert.ok(Array.isArray(value), "ancestorFailures must be an array");
  let previousTime = -Infinity; let previousTerminal; const ids = new Set();
  for (const [index, ancestor] of value.entries()) {
    exactKeys(ancestor, ["attemptId", "evidenceId", "digest", "artifactId", "artifactName", "archiveDigest", "runId", "runAttempt", "headSha", "baseSha", "parentSha", "terminalDevelopSha", "createdAt", ...(ancestor.provenance?["provenance"]:[])], `ancestorFailures[${index}]`);
    assert.match(ancestor.attemptId, /^g01-(?:a|recovery-a)[0-9]{2,}$/);
    assert.equal(ancestor.evidenceId, `bootstrap-failure.${ancestor.attemptId}.json`);
    assert.match(ancestor.digest, DIGEST); assert.match(ancestor.archiveDigest, DIGEST); assert.ok(Number.isInteger(ancestor.artifactId) && ancestor.artifactId > 0); assert.ok(Number.isInteger(ancestor.runId) && ancestor.runId > 0); assert.ok(Number.isInteger(ancestor.runAttempt) && ancestor.runAttempt > 0);
    const artifactTerminal = ancestor.provenance?.subjectTerminalDevelopSha ?? ancestor.terminalDevelopSha;
    assert.equal(typeof ancestor.artifactName, "string"); assert.match(ancestor.artifactName, new RegExp(`^g01-bootstrap-failure-${ancestor.attemptId}-run-${ancestor.runId}-attempt-${ancestor.runAttempt}-head-${artifactTerminal}-phase-(?:f11|selection)$`));
    for (const key of ["headSha", "baseSha", "parentSha", "terminalDevelopSha"]) assert.match(ancestor[key], SHA);
    assert.equal(ancestor.baseSha, ancestor.parentSha, "ancestor candidate must base on its frozen parent");
    if(ancestor.provenance){exactKeys(ancestor.provenance,["kind","authorityDigest","producerRunId","producerRunAttempt","producerHeadSha","recoveryTerminalDevelopSha","subjectTerminalDevelopSha"],`ancestorFailures[${index}].provenance`);assert.equal(ancestor.provenance.kind,"artifactless-run-backfill");assert.match(ancestor.provenance.authorityDigest,DIGEST);assert.match(ancestor.provenance.producerHeadSha,SHA);assert.match(ancestor.provenance.subjectTerminalDevelopSha,SHA);assert.equal(ancestor.provenance.recoveryTerminalDevelopSha,ancestor.terminalDevelopSha);assert.notEqual(ancestor.runId,ancestor.provenance.producerRunId)}
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
    if(!ancestor.provenance)validateArtifactAuthority(authority, { name: ancestor.artifactName, headSha: ancestor.terminalDevelopSha, headBranch: "develop", event: "push", repository, observedAt, runId: ancestor.runId, runAttempt: ancestor.runAttempt, completed: true, success: false }, "ancestor");
    else {const p=ancestor.provenance;assert.equal(authority.metadata?.id,ancestor.artifactId);assert.equal(authority.metadata?.name,ancestor.artifactName);assert.equal(authority.metadata?.digest,ancestor.archiveDigest);assert.equal(authority.downloadDigest,ancestor.archiveDigest);assert.equal(authority.payloadDigest,ancestor.digest);assert.equal(authority.matchCount,1);assert.equal(authority.run?.id,p.producerRunId);assert.equal(authority.run?.run_attempt,p.producerRunAttempt);assert.equal(authority.run?.head_sha,p.producerHeadSha);assert.equal(authority.run?.event,"pull_request");assert.equal(authority.run?.path,WORKFLOW_PATH);assert.equal(authority.run?.repository?.full_name,repository);assert.equal(authority.run?.status,"completed");assert.equal(authority.run?.conclusion,"success");assert.equal(authority.backfillAuthorityDigest,p.authorityDigest)}
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
  authenticateMergedPullRequest(pr, currentRun?.head_sha, "early recorder PR");
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
    exactKeys(record, ["failure", "artifactId", "artifactName", "artifactCreatedAt", "archiveDigest", "payloadDigest", "run", ...(record.provenance ? ["provenance"] : [])], "failure record");
    const failure = validateBootstrapFailure(record.failure);
    assert.equal(Number(failure.attemptId.match(/[0-9]+$/)[0]), expected, "failure ordinal mismatch");
    const recoveryTerminal = record.provenance?.recoveryTerminalDevelopSha ?? failure.terminalDevelopSha; assert.equal(recoveryTerminal, terminalDevelopSha, "failure terminal SHA mismatch");
    assert.match(record.archiveDigest, DIGEST); assert.match(record.payloadDigest, DIGEST);
    assert.ok(Number.isInteger(record.artifactId) && record.artifactId > 0);
    const artifactCreatedAt = authenticatedGitHubInstant(record.artifactCreatedAt, "failure artifact created_at"); assert.ok(instant(failure.createdAt, "failure createdAt") <= artifactCreatedAt, "failure artifact cannot predate its payload");
    assert.equal(record.run.id, failure.runId); assert.equal(record.run.run_attempt, failure.runAttempt);
    assert.equal(record.run.name, WORKFLOW_NAME); assert.equal(record.run.path, WORKFLOW_PATH);
    assert.equal(record.run.repository?.full_name, repository, "failure producer repository mismatch");
    assert.equal(record.run.head_sha, failure.terminalDevelopSha); assert.equal(record.run.head_branch, "develop"); assert.equal(record.run.event, "push"); assert.equal(record.run.status, "completed"); assert.notEqual(record.run.conclusion, "success");
    assert.equal(record.artifactName, `g01-bootstrap-failure-${failure.attemptId}-run-${failure.runId}-attempt-${failure.runAttempt}-head-${failure.terminalDevelopSha}-phase-${failure.failedPhase.toLowerCase()}`);
    if(record.provenance){exactKeys(record.provenance,["kind","authorityDigest","producerRunId","producerRunAttempt","producerHeadSha","recoveryTerminalDevelopSha","subjectTerminalDevelopSha"],"failure backfill provenance");assert.equal(record.provenance.kind,"artifactless-run-backfill");assert.match(record.provenance.authorityDigest,DIGEST);assert.match(record.provenance.producerHeadSha,SHA);assert.equal(record.provenance.subjectTerminalDevelopSha,failure.terminalDevelopSha);assert.notEqual(record.provenance.producerRunId,failure.runId)}
    return record;
  });
  authenticated.sort((a, b) => b.failure.runAttempt - a.failure.runAttempt || b.failure.runId - a.failure.runId || instant(b.failure.createdAt, "failure createdAt") - instant(a.failure.createdAt, "failure createdAt") || authenticatedGitHubInstant(b.artifactCreatedAt, "artifact createdAt") - authenticatedGitHubInstant(a.artifactCreatedAt, "artifact createdAt") || b.artifactId - a.artifactId);
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
  authenticateMergedPullRequest(authority.pr, f11.mergeSha, "selection PR");
  assert.equal(authority.pr.base?.ref, "develop");
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
  if (process.argv.includes("--build-review-comment")) {
    const identityPath = argument("--identity", true);
    const body = identityPath
      ? buildReviewCommentFromFiles({ identityPath, role: argument("--role"), laneId: argument("--lane-id"), reportPath: argument("--report"), parentsPath: argument("--parents", true) })
      : buildReviewComment(JSON.parse(fs.readFileSync(argument("--input"), "utf8")));
    process.stdout.write(`${body}\n`);
  } else {
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
}
