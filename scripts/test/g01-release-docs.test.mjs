import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildF9Envelope, buildF11Envelope, buildSelection } from "../evidence/emit-bootstrap-selection.mjs";
import { buildCandidateReport, buildF7Envelope, validateRegistry } from "../evidence/bootstrap-export.mjs";

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
  return { metadata: { id, name, expired: false, expires_at: "2026-10-18T00:00:00.000Z", digest: archiveDigest, workflow_run: { id: producingRun.id, head_sha: headSha } }, run: producingRun, downloadDigest: archiveDigest, payloadDigest: options.payloadDigest ?? digest("8"), matchCount: 1 };
}
function postMergeRun(merge = "b".repeat(40)) {
  const requiredJobs = ["Lint, typecheck & build", "Tests"].map((name, index) => ({ id: 800 + index, name, status: "completed", conclusion: "success", runId: 70, runAttempt: 2, headSha: merge }));
  return { id: 70, runAttempt: 2, checkSuiteId: 71, workflowId: 72, workflowName: "CI/CD", workflowPath: ".github/workflows/ci.yml", repository: REPOSITORY, event: "push", headBranch: "develop", headSha: merge, requiredJobs };
}
function pr({ head = "a".repeat(40), merge = "b".repeat(40), state = "open" } = {}) {
  return { number: 7, state, merged: state === "closed", merged_at: state === "closed" ? "2026-07-18T00:02:00.000Z" : null, merge_commit_sha: state === "closed" ? merge : null, base: { ref: "develop", sha: "9".repeat(40), repo: { full_name: REPOSITORY } }, head: { ref: BRANCH, sha: head, repo: { full_name: REPOSITORY } } };
}
function review(role, actorId, submittedAt, overrides = {}) {
  const verdict = role === "architect" ? "CLEAR" : "APPROVE";
  return { id: actorId, node_id: `R${actorId}`, state: "APPROVED", body: `[omx-role:${role} verdict:${verdict}]`, commit_id: "a".repeat(40), submitted_at: submittedAt, author_association: "MEMBER", user: { id: actorId }, ...overrides };
}
function chain() {
  const head = "a".repeat(40), merge = "b".repeat(40), report = candidateReport(head);
  const f7 = buildF7Envelope(report, head, BRANCH, "2026-07-18T00:00:00.000Z");
  const f7Artifact = artifactAuthority(1, `g01-candidate-evidence-${head}`, head, BRANCH, "pull_request", { status: "in_progress", conclusion: null, runId: 10 });
  const reviews = [review("code-reviewer", 11, "2026-07-18T00:00:10.000Z"), review("architect", 12, "2026-07-18T00:00:20.000Z"), review("verifier", 13, "2026-07-18T00:00:30.000Z")];
  const approvalAuthority = { pr: pr(), reviews, reviewAuthority: { "code-reviewer": 11, architect: 12, verifier: 13 }, observedAt: "2026-07-18T00:01:00.000Z", repository: REPOSITORY, f7Artifact, candidateReport: report };
  const f9 = buildF9Envelope(f7, approvalAuthority);
  const f9Artifact = artifactAuthority(2, "g01-approval-7", head, BRANCH, "pull_request", { runId: 10 });
  const mergeAuthority = { pr: pr({ state: "closed" }), developRef: { object: { sha: merge } }, sourceRefStatus: 404, postMergeRun: postMergeRun(merge), observedAt: "2026-07-18T00:04:00.000Z", repository: REPOSITORY, f7Artifact: { ...f7Artifact, run: { ...f7Artifact.run, status: "completed", conclusion: "success" } }, f9Artifact };
  const f11 = buildF11Envelope(f7, f9, mergeAuthority);
  const f11Artifact = artifactAuthority(3, "g01-merge-7", merge, "develop", "push", { runId: 70, runAttempt: 2, status: "in_progress", conclusion: null });
  const selectionAuthority = { ...mergeAuthority, observedAt: "2026-07-18T00:05:00.000Z", f11Artifact };
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
    { ...base.approvalAuthority, pr: { ...base.approvalAuthority.pr, head: { ...base.approvalAuthority.pr.head, repo: { full_name: "fork/VoiceRoom" } } } },
  ];
  for (const authority of hostile) assert.throws(() => buildF9Envelope(base.f7, authority));
});

test("artifact authentication rejects name, digest, expiry, uniqueness, producer workflow/event/repository/head/run attempt substitutions", () => {
  const base = chain();
  const mutations = [
    (a) => { a.metadata.name = "operator-substitution"; }, (a) => { a.downloadDigest = digest("9"); }, (a) => { a.metadata.expired = true; }, (a) => { a.matchCount = 2; },
    (a) => { a.run.path = ".github/workflows/other.yml"; }, (a) => { a.run.event = "workflow_dispatch"; }, (a) => { a.run.repository.full_name = "evil/repo"; }, (a) => { a.run.head_sha = "c".repeat(40); }, (a) => { a.metadata.workflow_run.id = 999; },
  ];
  for (const mutate of mutations) { const authority = structuredClone(base.mergeAuthority); mutate(authority.f7Artifact); assert.throws(() => buildF11Envelope(base.f7, base.f9, authority)); }
  const selection = structuredClone(base.selectionAuthority); selection.f11Artifact.run.run_attempt = 99; assert.throws(() => buildSelection(base.f7, base.f9, base.f11, selection));
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
  const ancestor = { attemptId: "g01-a01", evidenceId: "bootstrap-failure.g01-a01.json", digest: digest("4"), artifactId: 30, runId: 40, baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: ancestorSha, createdAt: "2026-07-17T23:59:00.000Z" };
  const authority = structuredClone(base.selectionAuthority);
  authority.pr.head.ref = recoveryBranch; authority.pr.base.sha = ancestorSha;
  authority.f7Artifact = artifactAuthority(1, `g01-candidate-evidence-${rf7.sourceSha}`, rf7.sourceSha, recoveryBranch, "pull_request", { runId: 10 });
  authority.f9Artifact = artifactAuthority(2, "g01-approval-7", rf7.sourceSha, recoveryBranch, "pull_request", { runId: 10 });
  const ancestorAuthority = artifactAuthority(30, "g01-bootstrap-failure-g01-a01", ancestorSha, "develop", "push", { runId: 40, conclusion: "failure", payloadDigest: ancestor.digest });
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
  const post = workflow.slice(workflow.indexOf("  bootstrap-postmerge:"), workflow.indexOf("\n  deploy:"));
  for (const token of ["github.ref == 'refs/heads/develop'", "commits/$GITHUB_SHA/pulls", "merge_commit_sha===process.env.GITHUB_SHA", "actions/runs/$GITHUB_RUN_ID/jobs", "Lint, typecheck & build", "Tests", "workflowPath", "download-digest", "artifact lookup must be unique", "g01-merge-", "bootstrap-selection:"]) assert.ok(post.includes(token), `missing lifecycle proof: ${token}`);
  assert.doesNotMatch(workflow, /workflow_dispatch|bootstrap_phase|bootstrap_f7_artifact_id|find \. -maxdepth 1 -name/);
  assert.doesNotMatch(post, /ghcr\.io|docker push|packages:\s*write/);
  const deploy = workflow.slice(workflow.indexOf("  deploy:")); assert.match(deploy, /needs: \[check, test\]/);
});

test("authority bytes match approved handoff digest", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("docs/releases/2.5.0/evidence/archive-authority.json")).digest("hex"); assert.equal(hash, "553190685993cebd114b4ab13402085f053914fd4c2c26e793b466e0ebe3670f");
});
