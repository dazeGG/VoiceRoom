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

function envelopes() {
  const head = "a".repeat(40), merge = "b".repeat(40);
  const candidateReport = { schemaVersion: 1, release: "2.5.0", registries: [] };
  const f7 = { schemaVersion: 1, goal: "G01", phase: "F7", status: "GREEN", evidenceId: "ci-bundle.g01.json", sourceSha: head, digest: `sha256:${crypto.createHash("sha256").update(JSON.stringify(candidateReport)).digest("hex")}`, createdAt: "2026-07-18T00:00:00.000Z" };
  const reviewObjects = [
    { role: "code-reviewer", verdict: "APPROVE", reviewId: 1, nodeId: "R1", actorId: 11, commitId: head, submittedAt: "2026-07-18T00:00:10.000Z" },
    { role: "architect", verdict: "CLEAR", reviewId: 2, nodeId: "R2", actorId: 12, commitId: head, submittedAt: "2026-07-18T00:00:20.000Z" },
    { role: "verifier", verdict: "APPROVE", reviewId: 3, nodeId: "R3", actorId: 13, commitId: head, submittedAt: "2026-07-18T00:00:30.000Z" },
  ];
  const compactDigest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  const f9 = { schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: "approval-envelope.g01.json", sourceSha: head, digest: compactDigest(reviewObjects), createdAt: "2026-07-18T00:01:00.000Z", f7Digest: f7.digest, reviewObjects };
  const f11Payload = { prNumber: 7, mergeSha: merge, runId: 70, checkSuiteId: 71 };
  const f11 = { schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: "merge-envelope.g01.json", sourceSha: merge, digest: compactDigest(f11Payload), createdAt: "2026-07-18T00:04:00.000Z", f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: merge, terminalDevelopSha: merge, remoteDeleted: true, mergedAt: "2026-07-18T00:02:00.000Z", remoteDeletionObservedAt: "2026-07-18T00:03:00.000Z", prNumber: 7, sourceBranch: "feature/2.5.0-g01-canonical-evidence-bootstrap", postMergeRunId: 70, postMergeCheckSuiteId: 71 };
  return { f7, f9, f11, candidateReport };
}

function artifact(id, headSha) { return { id, expired: false, workflow_run: { head_sha: headSha } }; }
function selectionAuthority({ f7, f9, f11 }, overrides = {}) {
  return {
    pr: { number: 7, state: "closed", merged: true, merged_at: f11.mergedAt, merge_commit_sha: f11.mergeSha, base: { ref: "develop", sha: "9".repeat(40) }, head: { ref: f11.sourceBranch, sha: f7.sourceSha } },
    developRef: { object: { sha: f11.mergeSha } }, sourceRefStatus: 404,
    postMergeRun: { id: f11.postMergeRunId, check_suite_id: f11.postMergeCheckSuiteId, head_sha: f11.mergeSha, head_branch: "develop", status: "completed", conclusion: "success" },
    observedAt: "2026-07-18T00:05:00.000Z", f7Artifact: artifact(1, f7.sourceSha), f9Artifact: artifact(2, f9.sourceSha), f11Artifact: artifact(3, f11.sourceSha), ...overrides,
  };
}

test("canonical docs and historical pointers are tracked", () => {
  const plan = read("docs/RELEASE_2.5.0_PLAN.md"), spec = read("docs/RELEASE_2.5.0_TEST_SPEC.md");
  assert.match(plan, /### G01 — canonical unified plan/);
  assert.match(spec, /G01 canonical unified plan/);
  for (const version of ["2.6.0", "2.7.0"]) assert.match(read(`docs/RELEASE_${version}_PLAN.md`), /^# Superseded target plan/);
});

test("authority and candidate registries are truthful and structurally validated", () => {
  const authority = json("docs/releases/2.5.0/evidence/archive-authority.json");
  assert.equal(authority.decision.startG01, true);
  assert.equal(authority.status, "ARCHIVE_AUTHORITY_GREEN");
  const attempts = json("docs/releases/2.5.0/evidence/bootstrap-attempts.json");
  const recoveries = json("docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json");
  validateRegistry(attempts, "bootstrap-attempts.json");
  validateRegistry(recoveries, "bootstrap-landed-recoveries.json");
  assert.equal(attempts.state, recoveries.state);
  assert.equal(fs.existsSync("docs/releases/2.5.0/evidence/bootstrap-lineage.json"), false);
});

test("candidate export rejects recursive future facts and forged registry fields", () => {
  const attempts = json("docs/releases/2.5.0/evidence/bootstrap-attempts.json");
  for (const forbidden of ["reviewerObjects", "f9Digest", "mergeSha", "remoteDeleted", "f11Status", "terminalKind", "selectionDigest"]) {
    const copy = structuredClone(attempts);
    copy.ordinalReconstruction.nested = { [forbidden]: true };
    assert.throws(() => validateRegistry(copy, "bootstrap-attempts.json"), /predicts future field/);
  }
  const extra = structuredClone(attempts); extra.forged = true;
  assert.throws(() => validateRegistry(extra, "bootstrap-attempts.json"), /unexpected field/);

  const inputs = ["bootstrap-attempts.json", "bootstrap-landed-recoveries.json"].map((name) => ({ filename: name, bytes: fs.readFileSync(`docs/releases/2.5.0/evidence/${name}`) }));
  const report = buildCandidateReport(inputs);
  const f7 = buildF7Envelope(report, "a".repeat(40), "2026-07-18T00:00:00.000Z");
  assert.deepEqual(Object.keys(f7), ["schemaVersion", "goal", "phase", "status", "evidenceId", "sourceSha", "digest", "createdAt"]);
  assert.equal(f7.phase, "F7");
  assert.equal(f7.digest, `sha256:${crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex")}`);
  assert.throws(() => buildCandidateReport(inputs.slice(0, 1)), /exactly two/);
  assert.throws(() => buildCandidateReport([inputs[0], inputs[0]]), /basenames/);
  const activeWithoutPointer = structuredClone(attempts); activeWithoutPointer.state = "G01_PREMERGE_ACTIVE";
  assert.throws(() => validateRegistry(activeWithoutPointer, "bootstrap-attempts.json"), /requires a canonical current pointer/);
});

test("authenticated F9 and F11 builders reject stale reviews, artifacts, merge and deletion facts", () => {
  const { f7, candidateReport } = envelopes(), head = f7.sourceSha, merge = "b".repeat(40);
  const reviews = [
    { id: 1, node_id: "R1", state: "APPROVED", body: "[omx-role:code-reviewer verdict:APPROVE]", commit_id: head, submitted_at: "2026-07-18T00:00:10.000Z", user: { id: 11 } },
    { id: 2, node_id: "R2", state: "APPROVED", body: "[omx-role:architect verdict:CLEAR]", commit_id: head, submitted_at: "2026-07-18T00:00:20.000Z", user: { id: 12 } },
    { id: 3, node_id: "R3", state: "APPROVED", body: "[omx-role:verifier verdict:APPROVE]", commit_id: head, submitted_at: "2026-07-18T00:00:30.000Z", user: { id: 13 } },
  ];
  const approval = { pr: { state: "open", base: { ref: "develop" }, head: { ref: "feature/2.5.0-g01-canonical-evidence-bootstrap", sha: head } }, reviews, observedAt: "2026-07-18T00:01:00.000Z", f7Artifact: artifact(1, head), candidateReport };
  const f9 = buildF9Envelope(f7, approval);
  for (const hostile of [
    { ...approval, pr: { ...approval.pr, head: { ...approval.pr.head, sha: "c".repeat(40) } } },
    { ...approval, reviews: reviews.map((review, index) => index === 1 ? { ...review, commit_id: "c".repeat(40) } : review) },
    { ...approval, reviews: reviews.slice(0, 2) },
    { ...approval, f7Artifact: artifact(9, "c".repeat(40)) },
  ]) assert.throws(() => buildF9Envelope(f7, hostile));
  const mergeAuthority = { pr: { number: 7, state: "closed", merged: true, merged_at: "2026-07-18T00:02:00.000Z", merge_commit_sha: merge, base: { ref: "develop" }, head: { ref: "feature/2.5.0-g01-canonical-evidence-bootstrap", sha: head } }, developRef: { object: { sha: merge } }, sourceRefStatus: 404, postMergeRun: { id: 70, check_suite_id: 71, head_sha: merge, head_branch: "develop", status: "completed", conclusion: "success" }, observedAt: "2026-07-18T00:04:00.000Z", f7Artifact: artifact(1, head), f9Artifact: artifact(2, head) };
  buildF11Envelope(f7, f9, mergeAuthority);
  for (const hostile of [
    { ...mergeAuthority, developRef: { object: { sha: "c".repeat(40) } } },
    { ...mergeAuthority, sourceRefStatus: 200 },
    { ...mergeAuthority, postMergeRun: { ...mergeAuthority.postMergeRun, conclusion: "failure" } },
    { ...mergeAuthority, f9Artifact: { ...artifact(2, head), expired: true } },
  ]) assert.throws(() => buildF11Envelope(f7, f9, hostile));
});

test("selection consumes concrete F7/F9/F11 envelopes and validates schema", () => {
  const { f7, f9, f11 } = envelopes();
  const selection = buildSelection(f7, f9, f11, selectionAuthority({ f7, f9, f11 }));
  const ajv = new Ajv2020({ allErrors: true, strict: true }); addFormats(ajv);
  const validateEnvelopeSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/envelope.schema.json"));
  for (const envelope of [f7, f9, f11]) assert.equal(validateEnvelopeSchema(envelope), true, JSON.stringify(validateEnvelopeSchema.errors));
  assert.equal(validateEnvelopeSchema({ ...f7, f11Digest: digest("9") }), false);
  assert.equal(validateEnvelopeSchema({ ...f7, status: "RED" }), false);
  const validate = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json"));
  assert.equal(validate(selection), true, JSON.stringify(validate.errors));
  assert.deepEqual(Object.keys(selection), ["schemaVersion", "release", "attemptId", "terminalKind", "f7Id", "f7Digest", "f9Id", "f9Digest", "f11Id", "f11Digest", "terminalDevelopSha", "createdAt", "remoteDeleted", "status", "ancestorFailures", "bootstrapSupersessionChainDigest"]);

  const recoverySuffix = "bootstrap-recovery-a02.json", ancestorSha = "c".repeat(40);
  const rf7 = { ...f7, evidenceId: `ci-bundle.${recoverySuffix}` };
  const rf9 = { ...f9, evidenceId: `approval-envelope.${recoverySuffix}` };
  const rf11 = { ...f11, evidenceId: `merge-envelope.${recoverySuffix}`, sourceBranch: "feature/2.5.0-g01-postmerge-bootstrap-a02" };
  const ancestors = [{ attemptId: "g01-a01", evidenceId: "bootstrap-failure.g01-a01.json", digest: digest("4"), artifactId: 4, runId: 5, baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: ancestorSha, createdAt: "2026-07-17T23:00:00.000Z" }];
  const recovery = buildSelection(rf7, rf9, rf11, selectionAuthority({ f7: rf7, f9: rf9, f11: rf11 }, { pr: { ...selectionAuthority({ f7: rf7, f9: rf9, f11: rf11 }).pr, base: { ref: "develop", sha: ancestorSha } } }), ancestors);
  assert.equal(validate(recovery), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...selection, f7Id: "ci-bundle.bootstrap-recovery-a99.json" }), false);
  assert.equal(validate({ ...selection, ancestorFailures: ancestors }), false);
  assert.equal(validate({ ...recovery, ancestorFailures: [] }), false);

  for (const schemaName of ["bootstrap-attempt", "bootstrap-landed-recovery"]) {
    const schema = ajv.compile(json(`docs/releases/2.5.0/evidence/schema/${schemaName}.schema.json`));
    const baseRecord = schemaName === "bootstrap-attempt"
      ? { attemptId: "g01-a01", ordinal: 1, branch: "feature/2.5.0-g01-canonical-evidence-bootstrap", headSha: "a".repeat(40), baseSha: "b".repeat(40), parentSha: "b".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 1 }
      : { attemptId: "g01-recovery-a01", branch: "feature/2.5.0-g01-postmerge-bootstrap-a01", headSha: "a".repeat(40), baseSha: "b".repeat(40), parentSha: "b".repeat(40), authorityDigest: digest("a"), planSpecPairDigest: digest("b"), firstAuthoritativeId: 1, priorFailureId: "bootstrap-failure.g01-a01.json", priorFailureDigest: digest("c") };
    assert.equal(schema(baseRecord), true, JSON.stringify(schema.errors));
    assert.equal(schema({ ...baseRecord, firstAuthoritativeId: "" }), false);
    assert.equal(schema({ ...baseRecord, firstAuthoritativeId: 0 }), false);
  }
});

test("selection rejects extra fields, forged digests, chronology and terminal kinds", () => {
  const base = envelopes();
  const authority = selectionAuthority(base);
  const cases = [
    () => buildSelection({ ...base.f7, digest: "garbage" }, base.f9, base.f11, authority),
    () => buildSelection(base.f7, { ...base.f9, createdAt: "2026-07-17T23:00:00.000Z" }, base.f11, authority),
    () => buildSelection(base.f7, base.f9, base.f11, { ...authority, observedAt: base.f11.createdAt }),
    () => buildSelection(base.f7, base.f9, { ...base.f11, remoteDeleted: false }, authority),
    () => buildSelection(base.f7, base.f9, base.f11, { ...authority, developRef: { object: { sha: "c".repeat(40) } } }),
    () => buildSelection(base.f7, base.f9, base.f11, { ...authority, sourceRefStatus: 200 }),
    () => buildSelection(base.f7, base.f9, base.f11, { ...authority, f11Artifact: artifact(99, "c".repeat(40)) }),
  ];
  for (const hostile of cases) assert.throws(hostile);
});

test("selection CLI emits compact JSON with one real LF", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g01-selection-"));
  try {
    const chain = envelopes();
    const values = { ...chain, authority: selectionAuthority(chain) };
    for (const [name, value] of Object.entries(values)) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value));
    const output = execFileSync(process.execPath, ["scripts/evidence/emit-bootstrap-selection.mjs", "--authority", path.join(directory, "authority.json"), "--f7", path.join(directory, "f7.json"), "--f9", path.join(directory, "f9.json"), "--f11", path.join(directory, "f11.json")]);
    assert.equal(output.at(-1), 0x0a);
    assert.notDeepEqual(output.subarray(-2), Buffer.from("\\n"));
    assert.equal(output.filter((byte) => byte === 0x0a).length, 1);
    JSON.parse(output.toString("utf8"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("bootstrap-plan emits F7 and exposes a validated post-F11 selection handoff", () => {
  const workflow = read(".github/workflows/ci.yml");
  const block = workflow.slice(workflow.indexOf("  bootstrap-plan:"), workflow.indexOf("\n  deploy:", workflow.indexOf("  bootstrap-plan:")));
  for (const command of [
    "python3 scripts/test/validate_release_250_plan.py docs/RELEASE_2.5.0_PLAN.md docs/RELEASE_2.5.0_TEST_SPEC.md",
    "node --test scripts/test/g01-release-docs.test.mjs scripts/test/g01-oras-lock.test.mjs",
    "node scripts/evidence/recover-landed-bootstrap.mjs --fixture scripts/test/fixtures/g01-landed-bootstrap-recovery.json --validate-only",
    "scripts/ci/run-actionlint.sh .github/workflows/ci.yml",
    "scripts/ci/run-oras.sh version",
    "node scripts/evidence/bootstrap-export.mjs docs/releases/2.5.0/evidence/bootstrap-attempts.json docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json > candidate-registry-report.g01.json",
    "node scripts/evidence/bootstrap-export.mjs --f7 --source-sha \"$SOURCE_SHA\" --created-at",
  ]) assert.ok(block.includes(command), `missing CI command: ${command}`);
  assert.match(block, /actions\/upload-artifact@/);
  assert.match(block, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(block, /ghcr\.io|docker push|deploy|packages:\s*write/);
  const lifecycle = workflow.slice(workflow.indexOf("  bootstrap-approval:"), workflow.indexOf("\n  deploy:", workflow.indexOf("  bootstrap-selection:")));
  for (const value of ["inputs.bootstrap_phase == 'approval'", "inputs.bootstrap_phase == 'merge'", "inputs.bootstrap_phase == 'selection'", "actions/artifacts/$F7_ARTIFACT_ID", "pulls/$PR_NUMBER/reviews", "git/ref/heads/develop", "test \"$status\" = 404", "--emit-f9", "--emit-f11", "emit-bootstrap-selection.mjs", "actions/upload-artifact@v4"]) assert.ok(lifecycle.includes(value), `missing authenticated lifecycle handoff: ${value}`);
  assert.doesNotMatch(workflow, /bootstrap_(metadata|f7|f9|f11)_b64|base64 --decode/);
  assert.match(block, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);
  assert.doesNotMatch(lifecycle, /ghcr\.io|docker push|packages:\s*write/);
});

test("authority bytes match approved handoff digest", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("docs/releases/2.5.0/evidence/archive-authority.json")).digest("hex");
  assert.equal(hash, "553190685993cebd114b4ab13402085f053914fd4c2c26e793b466e0ebe3670f");
});
