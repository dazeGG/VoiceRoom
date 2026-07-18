import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { artifactName, buildAuthenticatedEarlyFailure, buildF9Envelope, buildF11Envelope, buildSelection, envelopePayloadDigest, selectCanonicalFailure, validateBootstrapFailure, validateFallbackCandidatePair } from "../evidence/emit-bootstrap-selection.mjs";
import { activateCandidateReport, buildActivationCapture, buildCandidateReport, buildF7Envelope, prepareAndCreateBootstrapBranch, prepareBootstrapAuthority, reconstructNextOrdinal, validateRegistry } from "../evidence/bootstrap-export.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const digest = (character) => `sha256:${character.repeat(64)}`;
const compactDigest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const REPOSITORY = "dazeGG/VoiceRoom";
const BRANCH = "feature/2.5.0-g01-canonical-evidence-bootstrap";

function candidateReport(head = "a".repeat(40), attemptId = "g01-a02") {
  const ordinal = Number(attemptId.match(/[0-9]+$/)[0]);
  const replayRecord = { fixture: "authenticated prepared replay", observedMax: ordinal - 1 }, authorityDigest = compactDigest(replayRecord);
  const attempts = { schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentAttempt: attemptId, ordinalReconstruction: { complete: true, nextOrdinal: ordinal + 1, reason: "complete authenticated PR and workflow pagination" }, attempts: [{ attemptId, ordinal, branch: BRANCH, headSha: head, baseSha: "9".repeat(40), parentSha: "9".repeat(40), authorityDigest, planSpecPairDigest: digest("b"), firstAuthoritativeId: 7 }] };
  const recoveries = { schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentRecovery: null, landedAncestors: [] };
  return { schemaVersion: 1, release: "2.5.0", registries: [{ name: "bootstrap-attempts.json", sha256: "1".repeat(64), candidate: attempts }, { name: "bootstrap-landed-recoveries.json", sha256: "2".repeat(64), candidate: recoveries }], activationAuthority: { preparedAuthority: { authorityDigest, replayRecord }, activationCapture: {} } };
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
function capture(authority, report) { return buildActivationCapture(authority, report); }
function bindPrepared(authority, ordinal) {
  const replayRecord = { observedMax: ordinal - 1, fixture: "full replay is exercised by preparation tests" };
  authority.preparedAuthority = { schemaVersion: 1, release: "2.5.0", status: "READY", repository: authority.repository, observedAt: authority.observedAt, developSha: authority.pr.base.sha, nextOrdinal: ordinal, attemptId: authority.pr.head.ref === BRANCH ? `g01-a${String(ordinal).padStart(2, "0")}` : `g01-recovery-a${String(ordinal).padStart(2, "0")}`, branchName: authority.pr.head.ref, cleanupBranches: [], activeBranches: [], conflicts: [], authorityDigest: compactDigest(replayRecord), replayRecord };
  return authority;
}
function review(role, actorId, submittedAt, overrides = {}) {
  const verdict = role === "architect" ? "CLEAR" : "APPROVE";
  return { id: actorId, node_id: `R${actorId}`, state: "APPROVED", body: `[omx-role:${role} verdict:${verdict}]`, commit_id: "a".repeat(40), submitted_at: submittedAt, author_association: "MEMBER", user: { id: actorId }, ...overrides };
}
function chain(attemptId = "g01-a02") {
  const head = "a".repeat(40), merge = "b".repeat(40), report = candidateReport(head, attemptId);
  const f7 = buildF7Envelope(report, head, BRANCH, "2026-07-18T00:00:00.000Z");
  const f7Artifact = artifactAuthority(1, artifactName("candidate", f7, 10, 1), head, BRANCH, "pull_request", { status: "in_progress", conclusion: null, runId: 10, payload: f7 });
  const reviews = [review("code-reviewer", 11, "2026-07-18T00:00:10.000Z"), review("architect", 12, "2026-07-18T00:00:20.000Z"), review("verifier", 13, "2026-07-18T00:00:30.000Z")];
  const approvalAuthority = { pr: pr(), reviews, reviewAuthority: { "code-reviewer": 11, architect: 12, verifier: 13 }, observedAt: "2026-07-18T00:01:00.000Z", repository: REPOSITORY, f7Artifact, candidateReport: report, premergeAncestorArtifacts: [] };
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
  const historicalHead = "7".repeat(40), historicalBranch = "feature/2.5.0-g01-postmerge-bootstrap-a07";
  const historicalPr = { ...pr({ head: historicalHead }), id: 701, node_id: "PR_node_701", number: 701, head: { ref: historicalBranch, sha: historicalHead, repo: { full_name: REPOSITORY } } };
  const historicalRun = run(902, historicalHead, historicalBranch, "pull_request", "completed", "failure", 1);
  const authority = { repository: REPOSITORY, pr: currentPr, currentRun: run(901, currentPr.head.sha, currentPr.head.ref, "pull_request", "in_progress", null, 3), headCommit: { sha: currentPr.head.sha, parents: [{ sha: "8".repeat(40) }] }, prPages: [[historicalPr, currentPr, { id: 999, head: { ref: "notes-a99", sha: "6".repeat(40) } }]], runPages: [{ workflow_runs: [historicalRun, run(901, currentPr.head.sha, currentPr.head.ref, "pull_request", "in_progress", null, 3)] }], artifactPages: [{ artifacts: [{ id: 3, name: `g01-bootstrap-failure-g01-recovery-a07-run-902-attempt-1-head-${historicalHead}-phase-f11`, workflow_run: { id: 902 } }, { id: 4, name: "unrelated-g01-a99", workflow_run: { id: 901 } }] }], paginationComplete: true, observedAt: "2026-07-18T00:00:00.000Z", priorFailure: null };
  authority.capture = capture(authority, tracked);
  assert.equal(reconstructNextOrdinal(tracked, authority), 8);
  bindPrepared(authority, 8);
  const activated = activateCandidateReport(tracked, authority, Buffer.from("plan"), Buffer.from("spec"));
  assert.equal(activated.identity.attemptId, "g01-a08"); assert.equal(activated.ordinal, 8);
  const f7 = buildF7Envelope(activated.report, currentPr.head.sha, currentPr.head.ref, authority.observedAt); assert.equal(f7.attemptId, "g01-a08");
  assert.throws(() => activateCandidateReport(tracked, { ...authority, paginationComplete: false }, Buffer.from("plan"), Buffer.from("spec")), /completely consumed/);
  const forgedCapture = structuredClone(authority); forgedCapture.capture.pages.prs[0].sha256 = digest("f");
  assert.throws(() => reconstructNextOrdinal(tracked, forgedCapture), /page hash mismatch/);
  const expired = structuredClone(authority); expired.artifactPages[0].artifacts[0].expired = true; expired.capture = capture(expired, tracked); assert.equal(reconstructNextOrdinal(tracked, expired), 8, "expired immutable artifact metadata must still consume its ordinal");
  const conflict = structuredClone(authority); const duplicate = structuredClone(historicalPr); duplicate.id = 702; duplicate.number = 702; duplicate.node_id = "PR_node_702"; duplicate.head.sha = "5".repeat(40); conflict.prPages[0].push(duplicate); conflict.runPages[0].workflow_runs.push(run(904, duplicate.head.sha, historicalBranch, "pull_request")); conflict.artifactPages[0].artifacts.push({ id: 5, name: `g01-candidate-g01-recovery-a07-run-904-attempt-1-head-${duplicate.head.sha}`, expired: false, workflow_run: { id: 904 } }); assert.throws(() => capture(conflict, tracked), /conflicting canonical/);
  const waiting = structuredClone(authority); waiting.artifactPages[0].artifacts = []; assert.throws(() => capture(waiting, tracked), /unreconciled canonical/);
});

test("pre-branch preparation reconstructs without consuming ordinals and fails closed for active/conflicting history", () => {
  const inputs = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: name, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const tracked = buildCandidateReport(inputs), before = JSON.stringify(tracked), developRef = { object: { sha: "9".repeat(40) } };
  const empty = { repository: REPOSITORY, developRef, prPages: [[]], runPages: [{ workflow_runs: [] }], artifactPages: [{ artifacts: [] }], paginationComplete: true, observedAt: "2026-07-17T23:00:00.000Z" };
  const first = prepareBootstrapAuthority(tracked, empty);
  assert.equal(first.status, "READY"); assert.equal(first.nextOrdinal, 1); assert.equal(first.attemptId, "g01-a01"); assert.equal(first.branchName, BRANCH); assert.equal(JSON.stringify(tracked), before, "preparation must not consume the ordinal");
  assert.equal(first.authorityDigest, compactDigest(first.replayRecord)); assert.deepEqual(first.replayRecord.queries.artifacts.variables, { per_page: 100 }); assert.equal(first.replayRecord.queries.artifacts.includesExpiredMetadata, true); assert.deepEqual(first.replayRecord.snapshots.artifactPages, empty.artifactPages);

  const abandoned = { ...pr({ head: "7".repeat(40), state: "open" }), id: 77, number: 77, node_id: "PR77", state: "closed", merged: false, merged_at: null, merge_commit_sha: null };
  abandoned.head = { ...abandoned.head, ref: "feature/2.5.0-g01-postmerge-bootstrap-a07" };
  const history = structuredClone(empty); history.prPages = [[abandoned]];
  const recovered = prepareBootstrapAuthority(tracked, history);
  assert.equal(recovered.status, "READY"); assert.equal(recovered.nextOrdinal, 8); assert.equal(recovered.branchName, "feature/2.5.0-g01-postmerge-bootstrap-a08"); assert.deepEqual(recovered.cleanupBranches, [abandoned.head.ref]);

  const lost = structuredClone(empty); lost.artifactPages[0].artifacts.push({ id: 4, name: "g01-bootstrap-preparation-a12-run-1-attempt-1-head-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expired: true, workflow_run: { id: 1 } });
  const afterLost = prepareBootstrapAuthority(tracked, lost);
  assert.equal(afterLost.nextOrdinal, 13); assert.deepEqual(afterLost.replayRecord.expiredArtifactOrdinals, [12]);

  const active = structuredClone(history); active.prPages[0][0].state = "open";
  assert.equal(prepareBootstrapAuthority(tracked, active).status, "WAITING_ACTIVE_BRANCH");
  const conflict = structuredClone(history); const other = structuredClone(abandoned); other.id = 78; other.number = 78; other.node_id = "PR78"; other.head.sha = "6".repeat(40); conflict.prPages[0].push(other);
  const conflicted = prepareBootstrapAuthority(tracked, conflict); assert.equal(conflicted.status, "WAITING_CONFLICT"); assert.deepEqual(conflicted.conflicts, [7]);
  assert.throws(() => prepareBootstrapAuthority(tracked, { ...empty, paginationComplete: false }), /complete pagination/);
});

test("live pre-branch orchestration cleans provisional refs, rescans complete history, embeds authority and atomically creates one canonical ref", async () => {
  const registries = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: `docs/releases/2.5.0/evidence/${name}`, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const calls = [], develop = "9".repeat(40), treeSha = "8".repeat(40), commitSha = "7".repeat(40);
  let refs = [{ ref: `refs/heads/${BRANCH}`, object: { sha: "6".repeat(40) } }];
  const api = {
    async get(endpoint) { calls.push(["get", endpoint]); if (endpoint.endsWith("git/ref/heads/develop")) return { ref: "refs/heads/develop", object: { sha: develop } }; if (endpoint.includes("matching-refs")) return structuredClone(refs); if (endpoint.includes("git/commits/")) return { sha: develop, tree: { sha: "5".repeat(40) } }; throw Error(`unexpected GET ${endpoint}`); },
    async paginate(endpoint, variables) { calls.push(["paginate", endpoint, variables]); if (endpoint.endsWith("/pulls")) return [[]]; if (endpoint.includes("/runs")) return [{ workflow_runs: [] }]; return [{ artifacts: [] }]; },
    async deleteRef(ref, sha) { calls.push(["deleteRef", ref, sha]); refs = []; },
    async createBlob(body) { calls.push(["createBlob", body]); return { sha: crypto.createHash("sha1").update(body.content).digest("hex") }; },
    async createTree(body) { calls.push(["createTree", body]); return { sha: treeSha }; },
    async createCommit(body) { calls.push(["createCommit", body]); return { sha: commitSha }; },
    async createRef(body) { calls.push(["createRef", body]); return { ref: body.ref, object: { sha: body.sha } }; },
  };
  let tick = 0; const result = await prepareAndCreateBootstrapBranch({ api, repository: REPOSITORY, registries, planBytes: Buffer.from("plan"), specBytes: Buffer.from("spec"), observedAt: () => `2026-07-18T00:00:0${tick++}.000Z` });
  assert.equal(result.prepared.attemptId, "g01-a01"); assert.equal(result.registries.attempts.state, "G01_PRE_BRANCH"); assert.equal(result.registries.attempts.currentAttempt, null); assert.equal(result.registries.attempts.attempts.length, 0); assert.equal(result.registries.attempts.ordinalReconstruction.nextOrdinal, null); validateRegistry(result.registries.attempts, "bootstrap-attempts.json"); validateRegistry(result.registries.recoveries, "bootstrap-landed-recoveries.json");
  assert.equal(result.registries.attempts.preparedAuthority.authorityDigest, result.prepared.authorityDigest);
  assert.deepEqual(calls.filter(([name]) => name === "deleteRef").map(([, ref, sha]) => [ref, sha]), [[`heads/${BRANCH}`, "6".repeat(40)]]);
  assert.equal(calls.filter(([name]) => name === "createRef").length, 1); assert.deepEqual(calls.find(([name]) => name === "createRef")[1], { ref: `refs/heads/${BRANCH}`, sha: commitSha });
  const tree = calls.find(([name]) => name === "createTree")[1]; assert.ok(tree.tree.some(({ path }) => path.endsWith("bootstrap-attempts.json"))); assert.ok(tree.tree.some(({ path }) => path.endsWith("bootstrap-landed-recoveries.json")));
  assert.ok(calls.filter(([name]) => name === "paginate").length >= 6, "cleanup must force a complete rescan before creation");
});

test("live preparation creates a provisional recovery branch with complete authenticated lineage and next ordinal", async () => {
  const registries = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: `docs/releases/2.5.0/evidence/${name}`, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const terminal = "b".repeat(40), prior = { attemptId: "g01-recovery-a02", branch: "feature/2.5.0-g01-postmerge-bootstrap-a02", baseSha: "9".repeat(40), parentSha: "9".repeat(40), headSha: "a".repeat(40), authorityDigest: digest("1"), planSpecPairDigest: digest("2"), firstAuthoritativeId: 2, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("3") };
  const api = { async get(endpoint) { if (endpoint.endsWith("git/ref/heads/develop")) return { object: { sha: terminal } }; if (endpoint.includes("matching-refs")) return []; return { tree: { sha: "5".repeat(40) } }; }, async paginate(endpoint) { if (endpoint.endsWith("/pulls")) return [[{ ...pr({ state: "closed" }), id: 1, number: 1, node_id: "P1" }, { ...pr({ state: "closed" }), id: 2, number: 2, node_id: "P2", head: { ...pr().head, ref: prior.branch, sha: prior.headSha } }]]; if (endpoint.includes("/runs")) return [{ workflow_runs: [run(1, pr().head.sha, BRANCH, "pull_request"), run(2, prior.headSha, prior.branch, "pull_request")] }]; return [{ artifacts: [{ id: 1, name: `g01-candidate-g01-a01-run-1-attempt-1-head-${pr().head.sha}`, expired: false, workflow_run: { id: 1 } }, { id: 2, name: `g01-bootstrap-failure-g01-recovery-a02-run-2-attempt-1-head-${prior.headSha}-phase-f11`, expired: false, workflow_run: { id: 2 } }] }]; }, async createBlob() { return { sha: "4".repeat(40) }; }, async createTree() { return { sha: "3".repeat(40) }; }, async createCommit() { return { sha: "2".repeat(40) }; }, async createRef() {} };
  const priorFailure = { evidenceId: "bootstrap-failure.g01-recovery-a02.json", digest: digest("4"), terminalDevelopSha: terminal, recoveryLineage: [prior] };
  const result = await prepareAndCreateBootstrapBranch({ api, repository: REPOSITORY, registries, planBytes: Buffer.from("p"), specBytes: Buffer.from("s"), priorFailure, observedAt: "2026-07-18T00:00:00.000Z" });
  assert.equal(result.prepared.attemptId, "g01-recovery-a03"); assert.equal(result.registries.attempts.state, "G01_PRE_BRANCH"); assert.equal(result.registries.recoveries.currentRecovery, null); assert.deepEqual(result.registries.recoveries.landedAncestors, [prior]);
});

test("cleanup ref deletion is compare-and-delete and a SHA race aborts WAITING before branch creation", async () => {
  const registries = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: `docs/releases/2.5.0/evidence/${name}`, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) })); let created = false;
  const abandoned = { ...pr({ state: "closed" }), id: 9, number: 9, node_id: "P9", merged_at: null, merge_commit_sha: null, head: { ...pr().head, ref: BRANCH } };
  const api = { async get(endpoint) { if (endpoint.endsWith("git/ref/heads/develop")) return { object: { sha: "9".repeat(40) } }; if (endpoint.includes("matching-refs")) return [{ ref: `refs/heads/${BRANCH}`, object: { sha: "6".repeat(40) } }]; return { tree: { sha: "5".repeat(40) } }; }, async paginate(endpoint) { if (endpoint.endsWith("/pulls")) return [[abandoned]]; if (endpoint.includes("/runs")) return [{ workflow_runs: [] }]; return [{ artifacts: [] }]; }, async deleteRef(ref, sha) { assert.equal(sha, "6".repeat(40)); throw Error("cleanup ref changed or was recreated; WAITING"); }, async createRef() { created = true; } };
  await assert.rejects(() => prepareAndCreateBootstrapBranch({ api, repository: REPOSITORY, registries, planBytes: Buffer.from("p"), specBytes: Buffer.from("s"), observedAt: "2026-07-18T00:00:00.000Z" }), /WAITING/); assert.equal(created, false);
});

test("live pre-branch orchestration rejects consumed direct history and ref-create races without publishing a consumed ordinal", async () => {
  const registries = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: `docs/releases/2.5.0/evidence/${name}`, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const makeApi = ({ consumed = false, failCreate = false } = {}) => { const calls = []; return { calls,
    async get(endpoint) { if (endpoint.endsWith("git/ref/heads/develop")) return { object: { sha: "9".repeat(40) } }; if (endpoint.includes("matching-refs")) return consumed ? [{ ref: `refs/heads/${BRANCH}`, object: { sha: "6".repeat(40) } }] : []; return { tree: { sha: "5".repeat(40) } }; },
    async paginate(endpoint) { if (endpoint.endsWith("/pulls")) return [[]]; if (endpoint.includes("/runs")) return [{ workflow_runs: [] }]; return [{ artifacts: consumed ? [{ id: 1, name: `g01-selection-a01-run-1-attempt-1-head-${"a".repeat(40)}`, expired: false }] : [] }]; },
    async deleteRef(ref) { calls.push(["deleteRef", ref]); }, async createBlob() { return { sha: "4".repeat(40) }; }, async createTree() { return { sha: "3".repeat(40) }; }, async createCommit() { return { sha: "2".repeat(40) }; }, async createRef(body) { calls.push(["createRef", body]); if (failCreate) throw Error("422 reference already exists"); return body; },
  }; };
  let consumedTick = 0; const consumed = makeApi({ consumed: true }); await assert.rejects(() => prepareAndCreateBootstrapBranch({ api: consumed, repository: REPOSITORY, registries, planBytes: Buffer.from("p"), specBytes: Buffer.from("s"), observedAt: () => `2026-07-18T00:00:0${consumedTick++}.000Z` }), /prepared authority|WAITING|READY/); assert.equal(consumed.calls.some(([name]) => name === "createRef"), false);
  const raced = makeApi({ failCreate: true }); await assert.rejects(() => prepareAndCreateBootstrapBranch({ api: raced, repository: REPOSITORY, registries, planBytes: Buffer.from("p"), specBytes: Buffer.from("s"), observedAt: "2026-07-18T00:00:00.000Z" }), /ordinal was not consumed/); assert.equal(raced.calls.filter(([name]) => name === "createRef").length, 1);
});

test("pre-branch preparation CLI emits compact JSON with one real LF", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g01-prepare-"));
  try {
    const authority = { repository: REPOSITORY, developRef: { object: { sha: "9".repeat(40) } }, prPages: [[]], runPages: [{ workflow_runs: [] }], artifactPages: [{ artifacts: [] }], paginationComplete: true, observedAt: "2026-07-17T23:00:00.000Z" };
    const authorityPath = path.join(directory, "authority.json"); fs.writeFileSync(authorityPath, JSON.stringify(authority));
    const output = execFileSync(process.execPath, ["scripts/evidence/bootstrap-export.mjs", "--prepare", authorityPath, "docs/releases/2.5.0/evidence/bootstrap-attempts.json", "docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json"]);
    assert.equal(output.at(-1), 0x0a); assert.equal(output.filter((byte) => byte === 0x0a).length, 1); const prepared = JSON.parse(output); assert.equal(prepared.status, "READY"); assert.equal(prepared.nextOrdinal, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("PRE_BRANCH recovery activation excludes its current suffix and preserves the complete authenticated prior recovery chain", () => {
  const inputs = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: name, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const tracked = buildCandidateReport(inputs), terminal = "b".repeat(40), head = "c".repeat(40), branch = "feature/2.5.0-g01-postmerge-bootstrap-a03";
  const currentPr = { ...pr({ head }), base: { ...pr().base, sha: terminal }, head: { ...pr().head, ref: branch, sha: head } };
  const lineage = [{ attemptId: "g01-recovery-a02", branch: "feature/2.5.0-g01-postmerge-bootstrap-a02", baseSha: "9".repeat(40), parentSha: "9".repeat(40), headSha: "a".repeat(40), authorityDigest: digest("1"), planSpecPairDigest: digest("2"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("3") }];
  const authority = { repository: REPOSITORY, pr: currentPr, currentRun: run(903, head, branch, "pull_request", "in_progress", null, 2), headCommit: { sha: head, parents: [{ sha: terminal }] }, prPages: [[currentPr, { id: 2, head: { ref: "feature/2.5.0-g01-postmerge-bootstrap-a02" } }]], runPages: [{ workflow_runs: [run(903, head, branch, "pull_request", "in_progress", null, 2), run(902, head, branch, "pull_request", "completed", "failure", 1)] }], artifactPages: [{ artifacts: [{ id: 3, name: `g01-candidate-g01-recovery-a03-run-903-attempt-2-head-${head}`, workflow_run: { id: 903 } }, { id: 4, name: `g01-bootstrap-failure-g01-recovery-a03-run-902-attempt-1-head-${head}-phase-f11`, workflow_run: { id: 902 } }] }], paginationComplete: true, observedAt: "2026-07-18T00:00:00.000Z", priorFailure: { evidenceId: "bootstrap-failure.g01-recovery-a02.json", digest: digest("4"), terminalDevelopSha: terminal, recoveryLineage: lineage } };
  const priorPr = authority.prPages[0][1]; priorPr.id = 702; priorPr.node_id = "PR_node_702"; priorPr.number = 702; priorPr.head.sha = "d".repeat(40); priorPr.head.repo = { full_name: REPOSITORY }; priorPr.base = { ref: "develop", sha: "9".repeat(40), repo: { full_name: REPOSITORY } };
  const priorRun = run(902, priorPr.head.sha, priorPr.head.ref, "pull_request", "completed", "failure", 1); authority.runPages[0].workflow_runs.push(priorRun); authority.artifactPages[0].artifacts.push({ id: 5, name: `g01-bootstrap-failure-g01-recovery-a02-run-902-attempt-1-head-${priorPr.head.sha}-phase-f11`, expired: false, workflow_run: { id: 902 } });
  authority.capture = capture(authority, tracked);
  assert.equal(reconstructNextOrdinal(tracked, authority), 3, "current a03 candidate must not consume its own suffix");
  bindPrepared(authority, 3);
  const activated = activateCandidateReport(tracked, authority, Buffer.from("plan"), Buffer.from("spec"));
  const recovery = activated.report.registries.find((entry) => entry.name === "bootstrap-landed-recoveries.json").candidate;
  assert.deepEqual(recovery.landedAncestors.slice(0, -1), lineage); assert.deepEqual(activated.report.activationAuthority, { preparedAuthority: authority.preparedAuthority, activationCapture: authority.capture }); assert.equal(recovery.currentRecovery, "g01-recovery-a03"); assert.equal(recovery.landedAncestors.length, 2);
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
  const recoveryBranch = "feature/2.5.0-g01-postmerge-bootstrap-a02", report = candidateReport();
  report.registries[1].candidate = { schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentRecovery: "g01-recovery-a02", landedAncestors: [{ attemptId: "g01-recovery-a02", branch: recoveryBranch, baseSha: "9".repeat(40), parentSha: "9".repeat(40), headSha: base.head, authorityDigest: report.activationAuthority.preparedAuthority.authorityDigest, planSpecPairDigest: digest("2"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("3") }] };
  const rf7 = buildF7Envelope(report, base.head, recoveryBranch, "2026-07-18T00:00:00.000Z"), ancestor = { evidenceId: "bootstrap-failure.g01-a01.json", attemptId: "g01-a01", payloadDigest: digest("3"), artifactId: 91, artifactName: `g01-bootstrap-failure-g01-a01-run-80-attempt-1-head-${"9".repeat(40)}-phase-f11`, archiveDigest: digest("4"), downloadDigest: digest("4"), runId: 80, runAttempt: 1, headSha: "8".repeat(40), terminalDevelopSha: "9".repeat(40) };
  const recoveryAuthority = { ...base.approvalAuthority, pr: { ...base.approvalAuthority.pr, head: { ...base.approvalAuthority.pr.head, ref: recoveryBranch } }, candidateReport: report, f7Artifact: artifactAuthority(92, artifactName("candidate", rf7, 10, 1), base.head, recoveryBranch, "pull_request", { status: "in_progress", conclusion: null, runId: 10, payload: rf7 }), premergeAncestorArtifacts: [ancestor] };
  buildF9Envelope(rf7, recoveryAuthority); assert.throws(() => buildF9Envelope(rf7, { ...recoveryAuthority, premergeAncestorArtifacts: [] }), /every ordered ancestor/); assert.throws(() => buildF9Envelope(rf7, { ...recoveryAuthority, premergeAncestorArtifacts: [{ ...ancestor, payloadDigest: digest("9") }] }), /every ordered ancestor/);
});

test("same-ordinal failed reruns select one authenticated canonical terminal and reject exact-order conflicts", () => {
  const terminal = "b".repeat(40), base = { schemaVersion: 1, release: "2.5.0", status: "G01_LANDED_UNSEALED", attemptId: "g01-a08", evidenceId: "bootstrap-failure.g01-a08.json", failedPhase: "F11", baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: terminal, headSha: "a".repeat(40), runId: 40, runAttempt: 2, createdAt: "2026-07-18T00:00:00.000Z", reason: "failed closed", recoveryLineage: [] };
  const record = (failure, artifactId, payloadDigest = digest("1")) => ({ failure, artifactId, artifactName: `g01-bootstrap-failure-${failure.attemptId}-run-${failure.runId}-attempt-${failure.runAttempt}-head-${terminal}-phase-f11`, artifactCreatedAt: "2026-07-18T00:00:10.000Z", archiveDigest: digest("2"), payloadDigest, run: run(failure.runId, terminal, "develop", "push", "completed", "failure", failure.runAttempt) });
  const older = record({ ...base, runId: 39, runAttempt: 1, createdAt: "2026-07-17T23:59:00.000Z" }, 1);
  assert.equal(selectCanonicalFailure([older, record(base, 2)], 8, terminal).artifactId, 2);
  assert.throws(() => selectCanonicalFailure([record(base, 2), record(base, 3, digest("3"))], 8, terminal), /conflicting terminal artifacts/);
});

test("recovery failure validation and checkout-free recorder preserve complete authenticated provenance and lineage", () => {
  const head = "a".repeat(40), report = candidateReport(head), branch = "feature/2.5.0-g01-postmerge-bootstrap-a02", recovery = { attemptId: "g01-recovery-a02", branch, baseSha: "9".repeat(40), parentSha: "9".repeat(40), headSha: head, authorityDigest: report.activationAuthority.preparedAuthority.authorityDigest, planSpecPairDigest: digest("2"), firstAuthoritativeId: 2, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("3") };
  report.registries[0].candidate.currentAttempt = null; report.registries[0].candidate.attempts = [];
  report.registries[1].candidate.currentRecovery = recovery.attemptId; report.registries[1].candidate.landedAncestors = [recovery];
  const f7 = buildF7Envelope(report, head, branch, "2026-07-18T00:00:00.000Z"), producer = artifactAuthority(77, artifactName("candidate", f7, 10, 1), head, branch, "pull_request", { runId: 10, payload: f7 });
  const currentPr = pr(); currentPr.head.ref = branch; const reviews = [review("code-reviewer", 11, "2026-07-18T00:00:10.000Z"), review("architect", 12, "2026-07-18T00:00:20.000Z"), review("verifier", 13, "2026-07-18T00:00:30.000Z")];
  const ancestor = { evidenceId: "bootstrap-failure.g01-a01.json", attemptId: "g01-a01", payloadDigest: digest("3"), artifactId: 91, artifactName: `g01-bootstrap-failure-g01-a01-run-80-attempt-1-head-${"9".repeat(40)}-phase-f11`, archiveDigest: digest("4"), downloadDigest: digest("4"), runId: 80, runAttempt: 1, headSha: "8".repeat(40), terminalDevelopSha: "9".repeat(40) };
  const f9 = buildF9Envelope(f7, { pr: currentPr, reviews, reviewAuthority: { "code-reviewer": 11, architect: 12, verifier: 13 }, observedAt: "2026-07-18T00:01:00.000Z", repository: REPOSITORY, f7Artifact: producer, candidateReport: report, premergeAncestorArtifacts: [ancestor] });
  const approval = artifactAuthority(78, artifactName("approval", f9, 10, 1), head, branch, "pull_request", { runId: 10, payload: f9 });
  producer.run.status = "completed"; producer.run.conclusion = "success";
  approval.run.status = "completed"; approval.run.conclusion = "success";
  const mergedPr = pr({ state: "closed" }); mergedPr.head.ref = branch;
  const currentRun = run(90, mergedPr.merge_commit_sha, "develop", "push", "in_progress", null, 2);
  const failure = buildAuthenticatedEarlyFailure({ pr: mergedPr, currentRun, f7, f9, candidateReport: report, f7Artifact: producer, f9Artifact: approval, failedPhase: "F11", createdAt: "2026-07-18T00:05:00.000Z", reason: "checkout-free failure", repository: REPOSITORY });
  assert.deepEqual(failure.recoveryLineage, [recovery]); assert.equal(failure.runId, 90); assert.equal(failure.runAttempt, 2);
  assert.throws(() => validateBootstrapFailure({ ...failure, recoveryLineage: [] }), /nonempty/);
  assert.throws(() => validateBootstrapFailure({ ...failure, recoveryLineage: [{ ...recovery, attemptId: "g01-recovery-a03", branch: "feature/2.5.0-g01-postmerge-bootstrap-a03" }] }), /end at/);
  assert.throws(() => buildAuthenticatedEarlyFailure({ pr: mergedPr, currentRun, f7, f9, candidateReport: report, f7Artifact: { ...producer, run: { ...producer.run, repository: { full_name: "evil/repo" } } }, f9Artifact: approval, failedPhase: "F11", createdAt: "2026-07-18T00:05:00.000Z", reason: "forged", repository: REPOSITORY }));
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

test("fallback candidate lineage authenticates report, both archives, payloads and one exact producer run", () => {
  const base = chain(), authority = { repository: REPOSITORY, observedAt: "2026-07-18T00:04:00.000Z", f7Artifact: base.mergeAuthority.f7Artifact, f9Artifact: base.mergeAuthority.f9Artifact };
  validateFallbackCandidatePair(base.f7, base.f9, base.report, authority);
  const mutations = [
    (a, r) => { r.registries[0].sha256 = "0".repeat(64); },
    (a) => { a.f7Artifact.metadata.name = "relabelled"; },
    (a) => { a.f9Artifact.downloadDigest = digest("f"); },
    (a) => { a.f9Artifact.payloadDigest = digest("e"); },
    (a) => { a.f9Artifact.run.id += 1; a.f9Artifact.metadata.workflow_run.id += 1; },
    (a) => { a.f9Artifact.run.run_attempt += 1; },
    (a) => { a.f7Artifact.run.head_sha = "c".repeat(40); },
    (a) => { a.f7Artifact.run.conclusion = "failure"; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(authority), report = structuredClone(base.report); mutate(copy, report); assert.throws(() => validateFallbackCandidatePair(base.f7, base.f9, report, copy)); }
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
  assert.throws(() => buildSelection({ ...base.f7, attemptId: "g01-recovery-a02" }, base.f9, base.f11, base.selectionAuthority));
  assert.throws(() => buildSelection(base.f7, base.f9, { ...base.f11, attemptId: "g01-a99" }, base.selectionAuthority));
  for (const schemaName of ["bootstrap-attempt", "bootstrap-landed-recovery"]) {
    const validate = ajv.compile(json(`docs/releases/2.5.0/evidence/schema/${schemaName}.schema.json`));
    const record = schemaName === "bootstrap-attempt" ? candidateReport().registries[0].candidate.attempts[0] : { attemptId: "g01-recovery-a02", branch: "feature/2.5.0-g01-postmerge-bootstrap-a02", headSha: "a".repeat(40), baseSha: "b".repeat(40), parentSha: "b".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a02.json", priorFailureDigest: digest("c") };
    assert.equal(validate(record), true, JSON.stringify(validate.errors)); assert.equal(validate({ ...record, firstAuthoritativeId: "" }), false);
    if (schemaName === "bootstrap-attempt") assert.throws(() => validateRegistry({ schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentAttempt: "g01-a99", ordinalReconstruction: { complete: true, nextOrdinal: record.ordinal + 1, reason: "fixture" }, attempts: [{ ...record, attemptId: "g01-a99" }] }, "bootstrap-attempts.json"), /suffix/);
    else assert.throws(() => validateRegistry({ schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentRecovery: record.attemptId, landedAncestors: [{ ...record, branch: "feature/2.5.0-g01-postmerge-bootstrap-a03" }] }, "bootstrap-landed-recoveries.json"));
  }
});

test("unbounded structural schemas accept a100 while runtime binds every external identity", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true }); addFormats(ajv);
  const attemptSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-attempt.schema.json"));
  const direct = candidateReport("a".repeat(40), "g01-a100").registries[0].candidate.attempts[0]; assert.equal(attemptSchema(direct), true, JSON.stringify(attemptSchema.errors)); assert.throws(() => validateRegistry({ ...candidateReport().registries[0].candidate, attempts: [{ ...direct, ordinal: 101 }], currentAttempt: direct.attemptId, ordinalReconstruction: { complete: true, nextOrdinal: 102, reason: "fixture" } }, "bootstrap-attempts.json"), /suffix/);
  const recoverySchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-landed-recovery.schema.json")), recovery = { attemptId: "g01-recovery-a100", branch: "feature/2.5.0-g01-postmerge-bootstrap-a100", headSha: "a".repeat(40), baseSha: "b".repeat(40), parentSha: "b".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a99.json", priorFailureDigest: digest("c") };
  assert.equal(recoverySchema(recovery), true, JSON.stringify(recoverySchema.errors)); assert.throws(() => validateRegistry({ schemaVersion: 1, release: "2.5.0", state: "G01_PREMERGE_ACTIVE", currentRecovery: recovery.attemptId, landedAncestors: [{ ...recovery, branch: "feature/2.5.0-g01-postmerge-bootstrap-a101" }] }, "bootstrap-landed-recoveries.json"));
  const base = chain("g01-a100"), selection = buildSelection(base.f7, base.f9, base.f11, base.selectionAuthority), selectionSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json"));
  assert.equal(selection.attemptId, "g01-a100"); assert.equal(selectionSchema(selection), true, JSON.stringify(selectionSchema.errors)); const swapped = structuredClone(base.selectionAuthority); swapped.f9Artifact.run.id = 11; assert.throws(() => buildSelection(base.f7, base.f9, base.f11, swapped), /one premerge workflow run|artifact name/);
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
  const incompleteFailure = structuredClone(ancestorAuthority); incompleteFailure.run.conclusion = null; assert.throws(() => buildSelection(rf7, rf9, rf11, authority, [ancestor], [incompleteFailure]), /conclusion/);
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
  for (const token of ["activation-authority.json", "candidate.preparedAuthority", "prior-records.ndjson", "selectCanonicalFailure", "recoveryLineage"]) assert.ok(block.includes(token), `missing activation proof: ${token}`);
  assert.ok(read("scripts/evidence/bootstrap-export.mjs").includes("--prepare-live"), "live preparation CLI must exist"); assert.doesNotMatch(workflow, /OMX_G01_PREPARED_AUTHORITY_JSON|PREPARED_AUTHORITY_JSON/, "mutable prepared-authority transport is forbidden");
  assert.match(block, /path:\s*\|[\s\S]*activation-authority\.json/, "F7 artifact must persist replayable activation authority");
  const post = workflow.slice(workflow.indexOf("  bootstrap-postmerge:"), workflow.indexOf("\n  deploy:"));
  for (const token of ["github.ref == 'refs/heads/develop'", "commits/$GITHUB_SHA/pulls", "merge_commit_sha===process.env.GITHUB_SHA", "actions/runs/$GITHUB_RUN_ID/jobs", "Lint, typecheck & build", "Tests", "workflowPath", "download-digest", "g01-merge-", "bootstrap-selection:", "bootstrap-failure.", "github.run_attempt", "bootstrap-selection.$ATTEMPT_ID.json", "artifact-digest", "selection_sha256", "recoveryLineage", "always() &&", "fallback-prs.json", "fallback-artifacts.json"]) assert.ok(post.includes(token), `missing lifecycle proof: ${token}`);
  for (const token of ["id: postmerge_checkout", "steps.postmerge_checkout.outcome == 'failure'", "id: selection_checkout", "steps.selection_checkout.outcome == 'failure'", "test -f pr.json || gh api", "hashFiles('bootstrap-failure.*.json')"]) assert.ok(post.includes(token), `missing early-failure fallback proof: ${token}`);
  for (const token of ["early-f7.zip", "early-f9.zip", "selection-early-f7.zip", "selection-early-f9.zip", "early-producer-run.json", "buildAuthenticatedEarlyFailure", "candidate-registry-report.g01.json"]) assert.ok(post.includes(token), `checkout-free recorders must authenticate exact F7/F9 provenance: ${token}`);
  assert.match(post, /needs: \[check, test\][\s\S]*if: always\(\) && github\.event_name == 'push'/, "failed/cancelled dependencies must still run the landed-unsealed recorder");
  for (const token of ["premerge-ancestor-authorities.json", "premerge-ancestor-expected.json", "f9-ancestor.zip", "buildActivationCapture"]) assert.ok(workflow.includes(token), `missing premerge/replay proof: ${token}`);
  for (const token of ["validateFallbackCandidatePair", "fallback-$label-metadata.json", "fallback-$label-run.json", "fallback-$label.zip"]) assert.ok(workflow.includes(token), `missing authenticated fallback proof: ${token}`);
  for (const token of ["normalizedIdentities", "observedMax", "reconstructionDigest", "gh-api--paginate-completed-no-next-page"]) assert.ok(read("scripts/evidence/bootstrap-export.mjs").includes(token), `missing replayable activation field: ${token}`);
  assert.doesNotMatch(workflow, /workflow_dispatch|bootstrap_phase|bootstrap_f7_artifact_id|find \. -maxdepth 1 -name/);
  assert.doesNotMatch(post, /ghcr\.io|docker push|packages:\s*write/);
  const deploy = workflow.slice(workflow.indexOf("  deploy:")); assert.match(deploy, /needs: \[check, test\]/);
});

test("inline early recorders are checkout-free and executable across failed/skipped dependency states", () => {
  const parsed = JSON.parse(execFileSync("python3", ["-c", "import json,yaml; print(json.dumps(yaml.safe_load(open('.github/workflows/ci.yml'))))"]).toString());
  const f11 = parsed.jobs["bootstrap-f11-early-recorder"], selection = parsed.jobs["bootstrap-selection-early-recorder"];
  assert.deepEqual(f11.needs, ["check", "test"]); assert.deepEqual(selection.needs, ["check", "test", "bootstrap-postmerge", "bootstrap-f11-early-recorder"]);
  for (const job of [f11, selection]) { assert.match(job.if, /^always\(\)/); assert.equal(job.steps.some((step) => String(step.uses ?? "").startsWith("actions/checkout") || String(step.uses ?? "").startsWith("actions/setup-node")), false); assert.ok(job.steps.some((step) => step.uses === "actions/upload-artifact@v4")); }
  const route = ({ check, test, postmerge }) => { const f11Recorded = check !== "success" || test !== "success"; const selectionRecorded = postmerge !== "success" && !f11Recorded; return { f11Recorded, selectionRecorded }; };
  assert.deepEqual(route({ check: "failure", test: "success", postmerge: "skipped" }), { f11Recorded: true, selectionRecorded: false });
  assert.deepEqual(route({ check: "success", test: "cancelled", postmerge: "skipped" }), { f11Recorded: true, selectionRecorded: false });
  assert.deepEqual(route({ check: "success", test: "success", postmerge: "failure" }), { f11Recorded: false, selectionRecorded: true });
  assert.deepEqual(route({ check: "success", test: "success", postmerge: "skipped" }), { f11Recorded: false, selectionRecorded: true });
  assert.deepEqual(route({ check: "success", test: "success", postmerge: "success" }), { f11Recorded: false, selectionRecorded: false });
});

test("authority bytes match approved handoff digest", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("docs/releases/2.5.0/evidence/archive-authority.json")).digest("hex"); assert.equal(hash, "553190685993cebd114b4ab13402085f053914fd4c2c26e793b466e0ebe3670f");
});
