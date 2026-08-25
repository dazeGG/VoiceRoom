#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import { validateEnvelopeChain } from "./validate-envelope.mjs";

export const G01_WRITABLE = [
  "docs/RELEASE_2.5.0_PLAN.md", "docs/RELEASE_2.5.0_TEST_SPEC.md", "docs/RELEASE_2.6.0_PLAN.md", "docs/RELEASE_2.7.0_PLAN.md",
  "docs/releases/2.5.0/evidence/index.json", "docs/releases/2.5.0/evidence/bootstrap-attempts.json", "docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json", "docs/releases/2.5.0/evidence/archive-authority.json", "docs/releases/2.5.0/evidence/repair-ledger.json",
  "docs/releases/2.5.0/evidence/schema/envelope.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-attempt.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-landed-recovery.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json", "docs/releases/2.5.0/evidence/schema/archive-authority.schema.json", "docs/releases/2.5.0/evidence/schema/archive-map.schema.json", "docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization-envelope.schema.json",
  "docs/releases/2.5.0/repairs/README.md", "config/evidence/release-evidence-archive.v1.json", ".github/workflows/ci.yml", "scripts/test/validate_release_250_plan.py", "scripts/test/g01-release-docs.test.mjs", "scripts/test/g01-oras-lock.test.mjs", "scripts/test/g01-landed-bootstrap-recovery.test.mjs", "scripts/test/fixtures/g01-landed-bootstrap-recovery.json", "scripts/evidence/bootstrap-export.mjs", "scripts/evidence/validate-envelope.mjs", "scripts/evidence/recover-landed-bootstrap.mjs", "scripts/evidence/emit-bootstrap-selection.mjs", "scripts/ci/run-actionlint.sh", "config/tool-locks/actionlint-v1.7.12.json", "scripts/ci/run-oras.sh", "config/tool-locks/oras-v1.3.3.json",
];
export const RECOVERY_WRITABLE = [
  "docs/RELEASE_2.5.0_PLAN.md", "docs/RELEASE_2.5.0_TEST_SPEC.md", "docs/releases/2.5.0/evidence/bootstrap-attempts.json", "docs/releases/2.5.0/evidence/bootstrap-landed-recoveries.json", "docs/releases/2.5.0/evidence/schema/envelope.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-attempt.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-landed-recovery.schema.json", "docs/releases/2.5.0/evidence/schema/bootstrap-selection.schema.json", ".github/workflows/ci.yml", "scripts/test/validate_release_250_plan.py", "scripts/test/g01-release-docs.test.mjs", "scripts/test/g01-landed-bootstrap-recovery.test.mjs", "scripts/test/fixtures/g01-landed-bootstrap-recovery.json", "scripts/evidence/bootstrap-export.mjs", "scripts/evidence/validate-envelope.mjs", "scripts/evidence/recover-landed-bootstrap.mjs", "scripts/evidence/emit-bootstrap-selection.mjs",
];
export const RECOVERY_READ_ONLY = [
  ".gitignore", "docs/GIT_FLOW.md", "docs/RELEASE_2.6.0_PLAN.md", "docs/RELEASE_2.7.0_PLAN.md", "docs/releases/2.5.0/evidence/index.json", "docs/releases/2.5.0/evidence/archive-authority.json", "docs/releases/2.5.0/evidence/repair-ledger.json", "docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json", "docs/releases/2.5.0/evidence/schema/archive-authority.schema.json", "docs/releases/2.5.0/evidence/schema/archive-map.schema.json", "docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization-envelope.schema.json", "docs/releases/2.5.0/repairs/README.md", "config/evidence/release-evidence-archive.v1.json", "scripts/test/g01-oras-lock.test.mjs", "scripts/ci/run-actionlint.sh", "config/tool-locks/actionlint-v1.7.12.json", "scripts/ci/run-oras.sh", "config/tool-locks/oras-v1.3.3.json",
];

function exactArray(actual, expected, label) {
  assert.ok(Array.isArray(actual) && actual.length > 0, `${label} must be nonempty`);
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
  assert.deepEqual(actual, expected, `${label} does not match the frozen canonical catalog`);
}

function validSelection(facts) {
  const selection = facts.selection;
  try {
    const { terminalDevelopSha, lineageSuffix } = validateEnvelopeChain(facts.f7, facts.f9, facts.f11, { verifyCurrentInputs: false });
    assert.deepEqual(Object.keys(selection).sort(), ["ancestorFailures", "artifactBindings", "attemptId", "bootstrapSupersessionChainDigest", "createdAt", "evidenceId", "f11Digest", "f11Id", "f7Digest", "f7Id", "f9Digest", "f9Id", "release", "remoteDeleted", "schemaVersion", "selectionDigest", "status", "terminalDevelopSha", "terminalKind"].sort());
    assert.equal(selection.schemaVersion, 1); assert.equal(selection.release, "2.5.0");
    assert.equal(selection.status, "SELECTED_GREEN"); assert.equal(selection.remoteDeleted, true);
    assert.equal(selection.terminalDevelopSha, terminalDevelopSha);
    assert.equal(selection.f7Id, facts.f7.evidenceId); assert.equal(selection.f7Digest, facts.f7.digest);
    assert.equal(selection.f9Id, facts.f9.evidenceId); assert.equal(selection.f9Digest, facts.f9.digest);
    assert.equal(selection.f11Id, facts.f11.evidenceId); assert.equal(selection.f11Digest, facts.f11.digest);
    assert.equal(selection.attemptId, facts.f7.attemptId); assert.equal(facts.f7.attemptId, facts.f9.attemptId); assert.equal(facts.f9.attemptId, facts.f11.attemptId);
    assert.equal(selection.evidenceId, `bootstrap-selection.${selection.attemptId}.json`);
    const selectionCore = { ...selection }; delete selectionCore.selectionDigest; assert.equal(selection.selectionDigest, `sha256:${crypto.createHash("sha256").update(JSON.stringify(selectionCore)).digest("hex")}`);
    assert.equal(facts.f7.sourceBranch, facts.f9.sourceBranch); assert.equal(facts.f9.sourceBranch, facts.f11.sourceBranch);
    assert.deepEqual(Object.keys(selection.artifactBindings).sort(), ["f11", "f7", "f9"]);
    const payloadDigest = (envelope) => `sha256:${crypto.createHash("sha256").update(`${JSON.stringify(envelope)}\n`).digest("hex")}`;
    for (const [label, envelope, phase, headSha] of [["f7", facts.f7, "candidate", facts.f7.sourceSha], ["f9", facts.f9, "approval", facts.f7.sourceSha], ["f11", facts.f11, "merge", terminalDevelopSha]]) {
      const binding = selection.artifactBindings[label];
      assert.deepEqual(Object.keys(binding).sort(), ["archiveDigest", "artifactId", "artifactName", "headSha", "payloadDigest", "runAttempt", "runId"].sort());
      assert.ok(Number.isInteger(binding.artifactId) && binding.artifactId > 0); assert.ok(Number.isInteger(binding.runId) && binding.runId > 0); assert.ok(Number.isInteger(binding.runAttempt) && binding.runAttempt > 0);
      assert.equal(binding.artifactName, `g01-${phase}-${selection.attemptId}-run-${binding.runId}-attempt-${binding.runAttempt}-head-${headSha}`);
      assert.equal(binding.headSha, headSha); assert.match(binding.archiveDigest, /^sha256:[0-9a-f]{64}$/); assert.equal(binding.payloadDigest, payloadDigest(envelope));
    }
    assert.equal(selection.bootstrapSupersessionChainDigest, `sha256:${crypto.createHash("sha256").update(JSON.stringify(selection.ancestorFailures)).digest("hex")}`);
    assert.ok(Date.parse(facts.f11.createdAt) < Date.parse(selection.createdAt));
    assert.ok([facts.mergeSha, facts.developSha, facts.baseSha, facts.originSha, terminalDevelopSha].every((sha) => sha === facts.mergeSha));
    assert.ok(["direct-canonical", "landed-recovery"].includes(selection.terminalKind));
    if (selection.terminalKind === "direct-canonical") {
      assert.match(selection.attemptId, /^g01-a[0-9]{2,}$/); assert.equal(facts.f11.sourceBranch, "feature/2.5.0-g01-canonical-evidence-bootstrap"); assert.equal(lineageSuffix, "g01.json"); assert.equal(selection.ancestorFailures.length, 0);
    } else {
      const match = selection.attemptId.match(/^g01-recovery-a([0-9]{2,})$/); assert.ok(match);
      assert.ok(Number(match[1]) >= 2);
      assert.equal(lineageSuffix, `bootstrap-recovery-a${match[1]}.json`); assert.ok(selection.ancestorFailures.length > 0);
      assert.equal(facts.parentSha, selection.ancestorFailures.at(-1).terminalDevelopSha);
    }
    return true;
  } catch { return false; }
}

export function classifyBootstrap(facts) {
  if (!facts.firstAuthoritativeId) return "G01_PRE_BRANCH";
  if (!facts.mergeSha) return "G01_PREMERGE_ACTIVE";
  return validSelection(facts) ? "G01_SELECTED_GREEN" : "G01_LANDED_UNSEALED";
}

export function validateRecoveryFixture(fixture) {
  const keys = Object.keys(fixture).sort();
  assert.deepEqual(keys, ["cases", "g01Writable", "recoveryReadOnly", "recoveryWritable"]);
  exactArray(fixture.g01Writable, G01_WRITABLE, "g01Writable");
  exactArray(fixture.recoveryWritable, RECOVERY_WRITABLE, "recoveryWritable");
  exactArray(fixture.recoveryReadOnly, RECOVERY_READ_ONLY, "recoveryReadOnly");
  assert.ok(fixture.recoveryWritable.every((item) => fixture.g01Writable.includes(item)), "recovery writable paths must be contained by G01");
  assert.ok(!fixture.recoveryWritable.some((item) => fixture.recoveryReadOnly.includes(item)), "recovery writable/read-only catalogs must be disjoint");
  assert.ok(!fixture.recoveryWritable.some((item) => item.includes("bootstrap-lineage.json")), "bootstrap lineage cannot be recovery-writable");
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 10, "chronology fixtures must be non-vacuous");
  const names = new Set();
  for (const fixtureCase of fixture.cases) {
    assert.ok(!names.has(fixtureCase.name), "fixture case names must be unique");
    names.add(fixtureCase.name);
    assert.equal(classifyBootstrap(fixtureCase.facts), fixtureCase.expected, fixtureCase.name);
  }
  for (const required of ["direct-selected", "post-f11-pre-selection", "selection-before-f11", "terminal-sha-drift", "recovery-selected", "recovery-missing-ancestry", "develop-drift"]) assert.ok(names.has(required), `missing hostile chronology fixture: ${required}`);
  return fixture;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtureIndex = process.argv.indexOf("--fixture");
  const path = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
  if (!path || !process.argv.includes("--validate-only")) throw new Error("recovery is validate-only during G01");
  validateRecoveryFixture(JSON.parse(fs.readFileSync(path, "utf8")));
  console.log("landed bootstrap recovery fixture: PASS");
}
