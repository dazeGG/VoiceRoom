import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { artifactName, buildF9Envelope, buildF11Envelope, buildSelection, envelopePayloadDigest, selectCanonicalFailure } from "../evidence/emit-bootstrap-selection.mjs";
import { activateCandidateReport, buildCandidateReport, buildF7Envelope, reconstructNextOrdinal, validateRegistry } from "../evidence/bootstrap-export.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const digest = (character) => `sha256:${character.repeat(64)}`;
const compactDigest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const REPOSITORY = "dazeGG/VoiceRoom";
const BRANCH = "feature/2.5.0-g01-canonical-evidence-bootstrap";

function candidateReport(head = "a".repeat(40), attemptId = "g01-a02") {
  const ordinal = Number(attemptId.match(/[0-9]+$/)[0]);
  const attempts = { schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentAttempt: attemptId, ordinalReconstruction: { complete: true, nextOrdinal: ordinal + 1, reason: "complete authenticated PR and workflow pagination" }, attempts: [{ attemptId, ordinal, branch: BRANCH, headSha: head, baseSha: "9".repeat(40), parentSha: "9".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 7 }] };
  const recoveries = { schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentRecovery: null, landedAncestors: [] };
  return { schemaVersion: 1, release: "2.5.0", registries: [{ name: "bootstrap-attempts.json", sha256: "1".repeat(64), candidate: attempts }, { name: "bootstrap-landed-recoveries.json", sha256: "2".repeat(64), candidate: recoveries }] };
}

function run(id, headSha, headBranch, event, status = "completed", conclusion = "success", runAttempt = 1) {
  return { id, run_attempt: runAttempt, name: "CI/CD", path: ".github/workflows/ci.yml", event, head_sha: headSha, head_branch: headBranch, status, conclusion, repository: { full_name: REPOSITORY } };
}
function artifactAuthority(id, name, headSha, headBranch, event, options = {}) {
  const archiveDigest = options.archiveDigest ?? digest(String((id % 9) + 1));
  const producingRun = options.run ?? run(options.runId ?? id * 10, headSha, headBranch, event, options.status, options.conclusion, options.runAttempt);
  return { metadata: { id, name, expired: false, expires_at: "2026-10-18T00:00:00.000Z", digest: archiveDigest, workflow_run: { id: producingRun.id, head_sha: headSha } }, run: producingRun, downloadDigest: archiveDigest, payloadDigest: options.payload ? envelopePayloadDigest(options.payload) : options.payloadDigest ?? digest("8"), matchCount: 1 };
}
function postMergeRun(merge = "b".repeat(40)) {
  const requiredJobs = ["Lint, typecheck & build", "Tests"].map((name, index) => ({ id: 800 + index, name, status: "completed", conclusion: "success", runId: 70, runAttempt: 2, headSha: merge }));
  return { id: 70, runAttempt: 2, checkSuiteId: 71, workflowId: 72, workflowName: "CI/CD", workflowPath: ".github/workflows/ci.yml", repository: REPOSITORY, event: "push", headBranch: "develop", headSha: merge, requiredJobs };
}
function pr({ head = "a".repeat(40), merge = "b".repeat(40), state = "open" } = {}) {
  return { id: 700, node_id: "PR_node_7", number: 7, state, merged: state === "closed", merged_at: state === "closed" ? "2026-07-18T00:02:00.000Z" : null, merge_commit_sha: state === "closed" ? merge : null, base: { ref: "develop", sha: "9".repeat(40), repo: { full_name: REPOSITORY } }, head: { ref: BRANCH, sha: head, repo: { full_name: REPOSITORY } } };
}
function capture(authority) {
  const hash = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  const pages = (values) => values.map((value, index) => ({ index, sha256: hash(value) }));
  return { responses: { pr: hash(authority.pr), currentRun: hash(authority.currentRun), headCommit: hash(authority.headCommit) }, pages: { prs: pages(authority.prPages), runs: pages(authority.runPages), artifacts: pages(authority.artifactPages) }, facts: { prNumber: authority.pr.number, prId: authority.pr.id, prNodeId: authority.pr.node_id, runId: authority.currentRun.id, runAttempt: authority.currentRun.run_attempt, headSha: authority.pr.head.sha, headBranch: authority.pr.head.ref } };
}
function review(role, actorId, submittedAt, overrides = {}) {
  const verdict = role === "architect" ? "CLEAR" : "APPROVE";
  return { id: actorId, node_id: `R${actorId}`, state: "APPROVED", body: `[omx-role:${role} verdict:${verdict}]`, commit_id: "a".repeat(40), submitted_at: submittedAt, author_association: "MEMBER", user: { id: actorId }, ...overrides };
}
function chain() {
  const head = "a".repeat(40), merge = "b".repeat(40), report = candidateReport(head);
  const f7 = buildF7Envelope(report, head, BRANCH, "2026-07-18T00:00:00.000Z");
  const f7Artifact = artifactAuthority(1, artifactName("candidate", f7, 10, 1), head, BRANCH, "pull_request", { status: "in_progress", conclusion: null, runId: 10, payload: f7 });
  const reviews = [review("code-reviewer", 11, "2026-07-18T00:00:10.000Z"), review("architect", 12, "2026-07-18T00:00:20.000Z"), review("verifier", 13, "2026-07-18T00:00:30.000Z")];
  const approvalAuthority = { pr: pr(), reviews, reviewAuthority: { "code-reviewer": 11, architect: 12, verifier: 13 }, observedAt: "2026-07-18T00:01:00.000Z", repository: REPOSITORY, f7Artifact, candidateReport: report };
  const f9 = buildF9Envelope(f7, approvalAuthority);
  const f9Artifact = artifactAuthority(2, artifactName("approval", f9, 10, 1), head, BRANCH, "pull_request", { runId: 10, payload: f9 });
  const mergeAuthority = { pr: pr({ state: "closed" }), developRef: { object: { sha: merge } }, sourceRefStatus: 404, postMergeRun: postMergeRun(merge), observedAt: "2026-07-18T00:04:00.000Z", repository: REPOSITORY, f7Artifact: { ...f7Artifact, run: { ...f7Artifact.run, status: "completed", conclusion: "success" } }, f9Artifact };
  const f11 = buildF11Envelope(f7, f9, mergeAuthority);
  const f11Artifact = artifactAuthority(3, artifactName("merge", f11, 70, 2), merge, "develop", "push", { runId: 70, runAttempt: 2, status: "in_progress", conclusion: null, payload: f11 });
  const selectionAuthority = { ...mergeAuthority, observedAt: "2026-07-18T00:05:00.000Z", f11Artifact, selectionRun: f11Artifact.run };
  return { head, merge, report, f7, f9, f11, reviews, approvalAuthority, mergeAuthority, selectionAuthority };
}

test("canonical docs and historical pointers are tracked", () => {
  assert.match(read("docs/RELEASE_2.5.0_PLAN.md"), /### G01 — canonical unified plan/);
  assert.match(read("docs/RELEASE_2.5.0_TEST_SPEC.md"), /G01 canonical unified plan/);
  for (const version of ["2.6.0", "2.7.0"]) assert.match(read(`docs/RELEASE_${version}_PLAN.md`), /^# Superseded target plan/);
});

test("authority and candidate registries are truthful and structurally validated", () => {
  const authority = json("docs/releases/2.5.0/evidence/archive-authority.json"); assert.equal(authority.decision.startG01, true); assert.equal(authority.status, "ARCHIVE_AUTHORITY_GREEN");
  const attempts = json("docs/releases/2.5.0/evidence/bootstrap-attempts.json"), recoveries = json("docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json");
  validateRegistry(attempts, "bootstrap-attempts.json"); validateRegistry(recoveries, "bootstrap-landed-recoveries.json"); assert.equal(attempts.state, recoveries.state); assert.equal(fs.existsSync("docs/releases/2.5.0/evidence/bootstrap-lineage.json"), false);
});

test("candidate identity binds reconstructed current ordinal, registry, branch and head", () => {
  const report = candidateReport(), f7 = buildF7Envelope(report, "a".repeat(40), BRANCH, "2026-07-18T00:00:00.000Z");
  assert.equal(f7.attemptId, "g01-a02"); assert.equal(f7.sourceBranch, BRANCH);
  assert.throws(() => buildF7Envelope(candidateReport("a".repeat(40), "g01-a03"), "c".repeat(40), BRANCH, "2026-07-18T00:00:00.000Z"));
  const relabeled = candidateReport(); relabeled.registries[0].candidate.attempts[0].ordinal = 99;
  assert.throws(() => buildF7Envelope(relabeled, "a".repeat(40), BRANCH, "2026-07-18T00:00:00.000Z"), /ordinal/);
  const inactive = candidateReport(); inactive.registries[0].candidate.state = "G01_PRE_BRANCH";
  assert.throws(() => buildF7Envelope(inactive, "a".repeat(40), BRANCH, "2026-07-18T00:00:00.000Z"), /active/);
});

test("tracked PRE_BRANCH registries atomically derive executable F7 identity from authenticated current PR/run and 1+max observed ordinal", () => {
  const inputs = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: name, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const tracked = buildCandidateReport(inputs); const currentPr = pr();
  const authority = { repository: REPOSITORY, pr: currentPr, currentRun: run(901, currentPr.head.sha, currentPr.head.ref, "pull_request", "in_progress", null, 3), headCommit: { sha: currentPr.head.sha, parents: [{ sha: "8".repeat(40) }] }, prPages: [[{ id: 1, head: { ref: "feature/2.5.0-g01-postmerge-bootstrap-a04" } }, currentPr]], runPages: [{ workflow_runs: [{ id: 2, name: "historical" }, run(901, currentPr.head.sha, "feature/2.5.0-g01-postmerge-bootstrap-a99", "pull_request", "in_progress", null, 3)] }], artifactPages: [{ artifacts: [{ id: 3, name: `g01-bootstrap-failure-g01-recovery-a07-run-2-attempt-1-head-${"7".repeat(40)}-phase-f11` }, { id: 4, name: "g01-candidate-g01-recovery-a99-run-901-attempt-3-head-current", workflow_run: { id: 901 } }] }], paginationComplete: true, observedAt: "2026-07-18T00:00:00.000Z", priorFailure: null };
  authority.capture = capture(authority);
  assert.equal(reconstructNextOrdinal(tracked, authority), 8);
  const activated = activateCandidateReport(tracked, authority, Buffer.from("plan"), Buffer.from("spec"));
  assert.equal(activated.identity.attemptId, "g01-a08"); assert.equal(activated.ordinal, 8);
  const f7 = buildF7Envelope(activated.report, currentPr.head.sha, currentPr.head.ref, authority.observedAt); assert.equal(f7.attemptId, "g01-a08");
  assert.throws(() => activateCandidateReport(tracked, { ...authority, paginationComplete: false }, Buffer.from("plan"), Buffer.from("spec")), /completely consumed/);
  const forgedCapture = structuredClone(authority); forgedCapture.capture.pages.prs[0].sha256 = digest("f");
  assert.throws(() => reconstructNextOrdinal(tracked, forgedCapture), /page hash mismatch/);
});

test("PRE_BRANCH recovery activation excludes its current suffix and preserves the complete authenticated prior recovery chain", () => {
  const inputs = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: name, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const tracked = buildCandidateReport(inputs), terminal = "b".repeat(40), head = "c".repeat(40), branch = "feature/2.5.0-g01-postmerge-bootstrap-a03";
  const currentPr = { ...pr({ head }), base: { ...pr().base, sha: terminal }, head: { ...pr().head, ref: branch, sha: head } };
  const lineage = [{ attemptId: "g01-recovery-a02", branch: "feature/2.5.0-g01-postmerge-bootstrap-a02", baseSha: "9".repeat(40), parentSha: "9".repeat(40), headSha: "a".repeat(40), authorityDigest: digest("1"), planSpecPairDigest: digest("2"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("3") }];
  const authority = { repository: REPOSITORY, pr: currentPr, currentRun: run(903, head, branch, "pull_request", "in_progress", null, 2), headCommit: { sha: head, parents: [{ sha: terminal }] }, prPages: [[currentPr, { id: 2, head: { ref: "feature/2.5.0-g01-postmerge-bootstrap-a02" } }]], runPages: [{ workflow_runs: [run(903, head, branch, "pull_request", "in_progress", null, 2), run(902, head, branch, "pull_request", "completed", "failure", 1)] }], artifactPages: [{ artifacts: [{ id: 3, name: `g01-candidate-g01-recovery-a03-run-903-attempt-2-head-${head}`, workflow_run: { id: 903 } }, { id: 4, name: `g01-bootstrap-failure-g01-recovery-a03-run-902-attempt-1-head-${head}-phase-f11`, workflow_run: { id: 902 } }] }], paginationComplete: true, observedAt: "2026-07-18T00:00:00.000Z", priorFailure: { evidenceId: "bootstrap-failure.g01-recovery-a02.json", digest: digest("4"), terminalDevelopSha: terminal, recoveryLineage: lineage } };
  authority.capture = capture(authority);
  assert.equal(reconstructNextOrdinal(tracked, authority), 3, "current a03 candidate must not consume its own suffix");
  const activated = activateCandidateReport(tracked, authority, Buffer.from("plan"), Buffer.from("spec"));
  const recovery = activated.report.registries.find((entry) => entry.name === "bootstrap-landed-recoveries.json").candidate;
  assert.deepEqual(recovery.landedAncestors.slice(0, -1), lineage); assert.deepEqual(activated.report.activationAuthority, authority.capture); assert.equal(recovery.currentRecovery, "g01-recovery-a03"); assert.equal(recovery.landedAncestors.length, 2);
  const truncated = structuredClone(authority); truncated.priorFailure.recoveryLineage = [];
  assert.throws(() => activateCandidateReport(tracked, truncated, Buffer.from("plan"), Buffer.from("spec")), /complete prior lineage/);
});

test("candidate export rejects recursive future facts and forged registry fields", () => {
  const attempts = json("docs/releases/2.5.0/evidence/bootstrap-attempts.json");
  for (const forbidden of ["reviewerObjects", "f9Digest", "mergeSha", "remoteDeleted", "f11Status", "terminalKind", "selectionDigest"]) { const copy = structuredClone(attempts); copy.ordinalReconstruction.nested = { [forbidden]: true }; assert.throws(() => validateRegistry(copy, "bootstrap-attempts.json"), /predicts future field/); }
  const extra = structuredClone(attempts); extra.forged = true; assert.throws(() => validateRegistry(extra, "bootstrap-attempts.json"), /unexpected field/);
});

test("F9 requires three distinct configured trusted actors and effective exact-head approvals after F7", () => {
  const base = chain(); buildF9Envelope(base.f7, base.approvalAuthority);
  const hostile = [
    { ...base.approvalAuthority, reviewAuthority: { "code-reviewer": 11, architect: 11, verifier: 13 } },
    { ...base.approvalAuthority, reviews: base.reviews.map((r, i) => i === 1 ? { ...r, user: { id: 11 } } : r) },
    { ...base.approvalAuthority, reviews: base.reviews.map((r, i) => i === 1 ? { ...r, author_association: "NONE" } : r) },
    { ...base.approvalAuthority, reviews: base.reviews.map((r, i) => i === 1 ? { ...r, submitted_at: "2026-07-17T23:59:59.000Z" } : r) },
    { ...base.approvalAuthority, reviews: [...base.reviews, { ...base.reviews[0], id: 99, node_id: "R99", state: "CHANGES_REQUESTED", submitted_at: "2026-07-18T00:00:40.000Z" }] },
    { ...base.approvalAuthority, reviews: base.reviews.map((r, i) => i === 0 ? { ...r, body: `${r.body} [omx-role:architect verdict:CLEAR]` } : r) },
    { ...base.approvalAuthority, reviews: base.reviews.map((r, i) => i === 2 ? { ...r, submitted_at: "2026-07-18T00:00:15.000Z" } : r) },
    { ...base.approvalAuthority, pr: { ...base.approvalAuthority.pr, head: { ...base.approvalAuthority.pr.head, repo: { full_name: "fork/VoiceRoom" } } } },
  ];
  for (const authority of hostile) assert.throws(() => buildF9Envelope(base.f7, authority));
});

test("same-ordinal failed reruns select one authenticated canonical terminal and reject exact-order conflicts", () => {
  const terminal = "b".repeat(40), base = { schemaVersion: 1, release: "2.5.0", status: "G01_LANDED_UNSEALED", attemptId: "g01-a08", evidenceId: "bootstrap-failure.g01-a08.json", failedPhase: "F11", baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: terminal, headSha: "a".repeat(40), runId: 40, runAttempt: 2, createdAt: "2026-07-18T00:00:00.000Z", reason: "failed closed", recoveryLineage: [] };
  const record = (failure, artifactId, payloadDigest = digest("1")) => ({ failure, artifactId, artifactName: `g01-bootstrap-failure-${failure.attemptId}-run-${failure.runId}-attempt-${failure.runAttempt}-head-${terminal}-phase-f11`, artifactCreatedAt: "2026-07-18T00:00:10.000Z", archiveDigest: digest("2"), payloadDigest, run: run(failure.runId, terminal, "develop", "push", "completed", "failure", failure.runAttempt) });
  const older = record({ ...base, runId: 39, runAttempt: 1, createdAt: "2026-07-17T23:59:00.000Z" }, 1);
  assert.equal(selectCanonicalFailure([older, record(base, 2)], 8, terminal).artifactId, 2);
  assert.throws(() => selectCanonicalFailure([record(base, 2), record(base, 3, digest("3"))], 8, terminal), /conflicting terminal artifacts/);
});

test("artifact authentication rejects name, digest, expiry, uniqueness, producer workflow/event/repository/head/run attempt substitutions", () => {
  const base = chain();
  const mutations = [
    (a) => { a.metadata.name = "operator-substitution"; }, (a) => { a.downloadDigest = digest("9"); }, (a) => { a.metadata.expired = true; }, (a) => { a.matchCount = 2; },
    (a) => { a.run.path = ".github/workflows/other.yml"; }, (a) => { a.run.event = "workflow_dispatch"; }, (a) => { a.run.repository.full_name = "evil/repo"; }, (a) => { a.run.head_sha = "c".repeat(40); }, (a) => { a.metadata.workflow_run.id = 999; },
  ];
  for (const mutate of mutations) { const authority = structuredClone(base.mergeAuthority); mutate(authority.f7Artifact); assert.throws(() => buildF11Envelope(base.f7, base.f9, authority)); }
  const selection = structuredClone(base.selectionAuthority); selection.f11Artifact.run.run_attempt = 99; assert.throws(() => buildSelection(base.f7, base.f9, base.f11, selection));
  const payloadSwap = structuredClone(base.selectionAuthority); payloadSwap.f7Artifact.payloadDigest = envelopePayloadDigest({ ...base.f7, sourceSha: "c".repeat(40) }); assert.throws(() => buildSelection(base.f7, base.f9, base.f11, payloadSwap), /payload bytes/);
});

test("F11 binds exact ci.yml push/develop run and unique green check/test jobs", () => {
  const base = chain(); buildF11Envelope(base.f7, base.f9, base.mergeAuthority);
  const mutations = [
    (a) => { a.postMergeRun.event = "workflow_dispatch"; }, (a) => { a.postMergeRun.workflowPath = ".github/workflows/other.yml"; }, (a) => { a.postMergeRun.repository = "evil/repo"; },
    (a) => { a.postMergeRun.requiredJobs.pop(); }, (a) => { a.postMergeRun.requiredJobs[1].conclusion = "failure"; }, (a) => { a.postMergeRun.requiredJobs[1].name = "Lint, typecheck & build"; },
    (a) => { a.postMergeRun.requiredJobs[0].runAttempt = 1; },
  ];
  for (const mutate of mutations) { const authority = structuredClone(base.mergeAuthority); mutate(authority); assert.throws(() => buildF11Envelope(base.f7, base.f9, authority)); }
});

test("selection consumes authenticated F7/F9/F11 and schemas reject phase leakage and relabel", () => {
  const base = chain(), selection = buildSelection(base.f7, base.f9, base.f11, base.selectionAuthority);
  assert.equal(selection.attemptId, "g01-a02");
  const ajv = new Ajv2020({ allErrors: true, strict: true }); addFormats(ajv);
  const envelopeSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/envelope.schema.json")); for (const envelope of [base.f7, base.f9, base.f11]) assert.equal(envelopeSchema(envelope), true, JSON.stringify(envelopeSchema.errors));
  for (const leaked of [{ ...base.f7, prNumber: 1 }, { ...base.f9, mergeSha: base.merge }, { ...base.f11, reviewObjects: base.f9.reviewObjects }]) assert.equal(envelopeSchema(leaked), false);
  assert.equal(envelopeSchema({ ...base.f9, reviewObjects: base.f9.reviewObjects.map((item, index) => index === 2 ? { ...item, role: "code-reviewer" } : item) }), false, "schema must reject duplicate review roles");
  assert.equal(envelopeSchema({ ...base.f9, reviewObjects: base.f9.reviewObjects.map((item) => item.role === "architect" ? { ...item, verdict: "APPROVE" } : item) }), false, "schema must bind architect to CLEAR");
  const selectionSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json")); assert.equal(selectionSchema(selection), true, JSON.stringify(selectionSchema.errors));
  assert.equal(selectionSchema({ ...selection, attemptId: "g01-recovery-a02" }), false);
  assert.throws(() => buildSelection(base.f7, base.f9, { ...base.f11, attemptId: "g01-a99" }, base.selectionAuthority));
  for (const schemaName of ["bootstrap-attempt", "bootstrap-landed-recovery"]) {
    const validate = ajv.compile(json(`docs/releases/2.5.0/evidence/schema/${schemaName}.schema.json`));
    const record = schemaName === "bootstrap-attempt" ? candidateReport().registries[0].candidate.attempts[0] : { attemptId: "g01-recovery-a02", branch: "feature/2.5.0-g01-postmerge-bootstrap-a02", headSha: "a".repeat(40), baseSha: "b".repeat(40), parentSha: "b".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a02.json", priorFailureDigest: digest("c") };
    assert.equal(validate(record), true, JSON.stringify(validate.errors)); assert.equal(validate({ ...record, firstAuthoritativeId: "" }), false);
  }
});

test("recovery selection enforces ordinal/suffix parity and authenticates every ordered ancestor", () => {
  const base = chain(), recoveryBranch = "feature/2.5.0-g01-postmerge-bootstrap-a02", suffix = "bootstrap-recovery-a02.json", ancestorSha = "c".repeat(40);
  const rf7 = { ...base.f7, attemptId: "g01-recovery-a02", sourceBranch: recoveryBranch, evidenceId: `ci-bundle.${suffix}` };
  const rf9 = { ...base.f9, attemptId: "g01-recovery-a02", sourceBranch: recoveryBranch, evidenceId: `approval-envelope.${suffix}` };
  const rf11 = { ...base.f11, attemptId: "g01-recovery-a02", sourceBranch: recoveryBranch, evidenceId: `merge-envelope.${suffix}` };
  const ancestorName = `g01-bootstrap-failure-g01-a01-run-40-attempt-1-head-${ancestorSha}-phase-f11`;
  const ancestor = { attemptId: "g01-a01", evidenceId: "bootstrap-failure.g01-a01.json", digest: digest("4"), artifactId: 30, artifactName: ancestorName, archiveDigest: digest("4"), runId: 40, runAttempt: 1, headSha: "a".repeat(40), baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: ancestorSha, createdAt: "2026-07-17T23:59:00.000Z" };
  const authority = structuredClone(base.selectionAuthority);
  authority.pr.head.ref = recoveryBranch; authority.pr.base.sha = ancestorSha;
  authority.f7Artifact = artifactAuthority(1, artifactName("candidate", rf7, 10, 1), rf7.sourceSha, recoveryBranch, "pull_request", { runId: 10, payload: rf7 });
  authority.f9Artifact = artifactAuthority(2, artifactName("approval", rf9, 10, 1), rf7.sourceSha, recoveryBranch, "pull_request", { runId: 10, payload: rf9 });
  authority.f11Artifact = artifactAuthority(3, artifactName("merge", rf11, 70, 2), rf11.sourceSha, "develop", "push", { runId: 70, runAttempt: 2, status: "in_progress", conclusion: null, payload: rf11 });
  const ancestorAuthority = artifactAuthority(30, ancestorName, ancestorSha, "develop", "push", { runId: 40, conclusion: "failure", payloadDigest: ancestor.digest, archiveDigest: ancestor.archiveDigest });
  const selection = buildSelection(rf7, rf9, rf11, authority, [ancestor], [ancestorAuthority]); assert.equal(selection.attemptId, "g01-recovery-a02");
  assert.throws(() => buildSelection({ ...rf7, attemptId: "g01-recovery-a03" }, rf9, rf11, authority, [ancestor], [ancestorAuthority]));
  assert.throws(() => buildSelection(rf7, rf9, rf11, authority, [ancestor], [{ ...ancestorAuthority, payloadDigest: digest("5") }]));
  assert.throws(() => buildSelection(rf7, rf9, rf11, authority, [{ ...ancestor, evidenceId: "bootstrap-failure.g01-a99.json" }], [ancestorAuthority]));
});

test("selection CLI emits compact JSON with one real LF", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g01-selection-"));
  try { const base = chain(); for (const name of ["f7", "f9", "f11"]) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(base[name])); fs.writeFileSync(path.join(directory, "authority.json"), JSON.stringify(base.selectionAuthority));
    const output = execFileSync(process.execPath, ["scripts/evidence/emit-bootstrap-selection.mjs", "--authority", path.join(directory, "authority.json"), "--f7", path.join(directory, "f7.json"), "--f9", path.join(directory, "f9.json"), "--f11", path.join(directory, "f11.json")]); assert.equal(output.at(-1), 0x0a); assert.notDeepEqual(output.subarray(-2), Buffer.from("\\n")); assert.equal(output.filter((byte) => byte === 0x0a).length, 1); JSON.parse(output.toString("utf8"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("workflow has reachable bounded premerge F9 and automatic merged-commit F11/selection with authenticated provenance", () => {
  const workflow = read(".github/workflows/ci.yml"); const block = workflow.slice(workflow.indexOf("  bootstrap-plan:"), workflow.indexOf("\n  bootstrap-postmerge:"));
  assert.match(block, /github\.event_name == 'pull_request'/); assert.match(block, /head\.repo\.full_name == github\.repository/); assert.match(block, /environment: g01-bootstrap-approval-authority/); assert.match(block, /timeout-minutes: 45/); assert.match(block, /sleep 20/); assert.match(block, /--source-branch "\$SOURCE_BRANCH"/); assert.match(block, /OMX_G01_CODE_REVIEWER_ID/);
  for (const token of ["activation-authority.json", "prior-records.ndjson", "selectCanonicalFailure", "recoveryLineage"]) assert.ok(block.includes(token), `missing activation proof: ${token}`);
  assert.match(block, /path:\s*\|[\s\S]*activation-authority\.json/, "F7 artifact must persist replayable activation authority");
  const post = workflow.slice(workflow.indexOf("  bootstrap-postmerge:"), workflow.indexOf("\n  deploy:"));
  for (const token of ["github.ref == 'refs/heads/develop'", "commits/$GITHUB_SHA/pulls", "merge_commit_sha===process.env.GITHUB_SHA", "actions/runs/$GITHUB_RUN_ID/jobs", "Lint, typecheck & build", "Tests", "workflowPath", "download-digest", "g01-merge-", "bootstrap-selection:", "bootstrap-failure.", "github.run_attempt", "bootstrap-selection.$ATTEMPT_ID.json", "artifact-digest", "selection_sha256", "recoveryLineage", "always() &&", "fallback-prs.json", "fallback-artifacts.json"]) assert.ok(post.includes(token), `missing lifecycle proof: ${token}`);
  for (const token of ["id: postmerge_checkout", "steps.postmerge_checkout.outcome == 'failure'", "id: selection_checkout", "steps.selection_checkout.outcome == 'failure'", "test -f pr.json || gh api", "hashFiles('bootstrap-failure.*.json')"]) assert.ok(post.includes(token), `missing early-failure fallback proof: ${token}`);
  assert.doesNotMatch(workflow, /workflow_dispatch|bootstrap_phase|bootstrap_f7_artifact_id|find \. -maxdepth 1 -name/);
  assert.doesNotMatch(post, /ghcr\.io|docker push|packages:\s*write/);
  const deploy = workflow.slice(workflow.indexOf("  deploy:")); assert.match(deploy, /needs: \[check, test\]/);
});

test("authority bytes match approved handoff digest", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("docs/releases/2.5.0/evidence/archive-authority.json")).digest("hex"); assert.equal(hash, "553190685993cebd114b4ab13402085f053914fd4c2c26e793b466e0ebe3670f");
});
