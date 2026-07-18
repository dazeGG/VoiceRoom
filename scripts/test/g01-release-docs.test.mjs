import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildSelection } from "../evidence/emit-bootstrap-selection.mjs";
import { buildCandidateReport, buildF7Envelope, validateRegistry } from "../evidence/bootstrap-export.mjs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const digest = (character) => `sha256:${character.repeat(64)}`;

function envelopes() {
  const head = "a".repeat(40), merge = "b".repeat(40);
  const f7 = { schemaVersion: 1, goal: "G01", phase: "F7", status: "GREEN", evidenceId: "ci-bundle.g01.json", sourceSha: head, digest: digest("1"), createdAt: "2026-07-18T00:00:00.000Z" };
  const f9 = { schemaVersion: 1, goal: "G01", phase: "F9", status: "GREEN", evidenceId: "approval-envelope.g01.json", sourceSha: head, digest: digest("2"), createdAt: "2026-07-18T00:01:00.000Z", f7Digest: f7.digest };
  const f11 = { schemaVersion: 1, goal: "G01", phase: "F11", status: "GREEN", evidenceId: "merge-envelope.g01.json", sourceSha: merge, digest: digest("3"), createdAt: "2026-07-18T00:04:00.000Z", f7Digest: f7.digest, f9Digest: f9.digest, mergeSha: merge, terminalDevelopSha: merge, remoteDeleted: true, mergedAt: "2026-07-18T00:02:00.000Z", remoteDeletionObservedAt: "2026-07-18T00:03:00.000Z" };
  return { f7, f9, f11 };
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
});

test("selection consumes concrete F7/F9/F11 envelopes and validates schema", () => {
  const { f7, f9, f11 } = envelopes();
  const selection = buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, f7, f9, f11);
  const ajv = new Ajv2020({ allErrors: true, strict: true }); addFormats(ajv);
  const validateEnvelopeSchema = ajv.compile(json("docs/releases/2.5.0/evidence/schema/envelope.schema.json"));
  for (const envelope of [f7, f9, f11]) assert.equal(validateEnvelopeSchema(envelope), true, JSON.stringify(validateEnvelopeSchema.errors));
  assert.equal(validateEnvelopeSchema({ ...f7, f11Digest: digest("9") }), false);
  const validate = ajv.compile(json("docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json"));
  assert.equal(validate(selection), true, JSON.stringify(validate.errors));
  assert.deepEqual(Object.keys(selection), ["schemaVersion", "release", "attemptId", "terminalKind", "f7Id", "f7Digest", "f9Id", "f9Digest", "f11Id", "f11Digest", "terminalDevelopSha", "createdAt", "remoteDeleted", "status", "ancestorFailures", "bootstrapSupersessionChainDigest"]);

  const recoverySuffix = "bootstrap-recovery-a02.json";
  const recovery = buildSelection({
    attemptId: "g01-recovery-a02",
    terminalKind: "landed-recovery",
    createdAt: "2026-07-18T00:05:00.000Z",
    ancestorFailures: [{ attemptId: "g01-a01", evidenceId: "bootstrap-failure.g01-a01.json", digest: digest("4"), terminalDevelopSha: "c".repeat(40), createdAt: "2026-07-17T23:00:00.000Z" }],
  },
  { ...f7, evidenceId: `ci-bundle.${recoverySuffix}` },
  { ...f9, evidenceId: `approval-envelope.${recoverySuffix}` },
  { ...f11, evidenceId: `merge-envelope.${recoverySuffix}` });
  assert.equal(validate(recovery), true, JSON.stringify(validate.errors));
});

test("selection rejects extra fields, forged digests, chronology and terminal kinds", () => {
  const base = envelopes();
  const cases = [
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "DIRECT_CANONICAL", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, base.f7, base.f9, base.f11),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [], forged: true }, base.f7, base.f9, base.f11),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, { ...base.f7, digest: "garbage" }, base.f9, base.f11),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, base.f7, { ...base.f9, createdAt: "2026-07-17T23:00:00.000Z" }, base.f11),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:04:00.000Z", ancestorFailures: [] }, base.f7, base.f9, base.f11),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, base.f7, base.f9, { ...base.f11, remoteDeleted: false }),
    () => buildSelection({ attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, base.f7, base.f9, { ...base.f11, terminalDevelopSha: "c".repeat(40) }),
    () => buildSelection({ attemptId: "g01-recovery-a02", terminalKind: "landed-recovery", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [{ attemptId: "g01-a01", evidenceId: "bootstrap-failure.g01-recovery-a99.json", digest: digest("4"), terminalDevelopSha: "c".repeat(40), createdAt: "2026-07-17T23:00:00.000Z" }] }, { ...base.f7, evidenceId: "ci-bundle.bootstrap-recovery-a02.json" }, { ...base.f9, evidenceId: "approval-envelope.bootstrap-recovery-a02.json" }, { ...base.f11, evidenceId: "merge-envelope.bootstrap-recovery-a02.json" }),
  ];
  for (const hostile of cases) assert.throws(hostile);
});

test("selection CLI emits compact JSON with one real LF", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g01-selection-"));
  try {
    const values = { metadata: { attemptId: "g01-a01", terminalKind: "direct-canonical", createdAt: "2026-07-18T00:05:00.000Z", ancestorFailures: [] }, ...envelopes() };
    for (const [name, value] of Object.entries(values)) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value));
    const output = execFileSync(process.execPath, ["scripts/evidence/emit-bootstrap-selection.mjs", "--metadata", path.join(directory, "metadata.json"), "--f7", path.join(directory, "f7.json"), "--f9", path.join(directory, "f9.json"), "--f11", path.join(directory, "f11.json")]);
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
    "node scripts/evidence/bootstrap-export.mjs --f7 --source-sha \"$GITHUB_SHA\" --created-at",
  ]) assert.ok(block.includes(command), `missing CI command: ${command}`);
  assert.match(block, /actions\/upload-artifact@/);
  assert.match(block, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(block, /ghcr\.io|docker push|deploy|packages:\s*write/);
  const selection = workflow.slice(workflow.indexOf("  bootstrap-selection:"), workflow.indexOf("\n  deploy:", workflow.indexOf("  bootstrap-selection:")));
  for (const value of ["github.event_name == 'workflow_dispatch'", "emit-bootstrap-selection.mjs", "bootstrap-selection.${attempt_id}.json", "actions/upload-artifact@v4"]) assert.ok(selection.includes(value), `missing selection handoff: ${value}`);
  assert.match(selection, /METADATA_B64: \$\{\{ inputs\.bootstrap_metadata_b64 \}\}/);
  assert.doesNotMatch(selection, /ghcr\.io|docker push|deploy|packages:\s*write/);
});

test("authority bytes match approved handoff digest", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync("docs/releases/2.5.0/evidence/archive-authority.json")).digest("hex");
  assert.equal(hash, "553190685993cebd114b4ab13402085f053914fd4c2c26e793b466e0ebe3670f");
});
