#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

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
  ".gitignore", "docs/GIT_FLOW.md", "docs/RELEASE_2.6.0_PLAN.md", "docs/RELEASE_2.7.0_PLAN.md", "docs/releases/2.5.0/evidence/index.json", "docs/releases/2.5.0/evidence/archive-authority.json", "docs/releases/2.5.0/evidence/repair-ledger.json", "docs/releases/2.5.0/evidence/schema/bootstrap-lineage.schema.json", "docs/releases/2.5.0/evidence/schema/archive-authority.schema.json", "docs/releases/2.5.0/evidence/schema/archive-map.schema.json", "docs/releases/2.5.0/evidence/schema/archive-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-ledger.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization.schema.json", "docs/releases/2.5.0/evidence/schema/repair-authorization-envelope.schema.json", "docs/releases/2.5.0/repairs/README.md", "config/evidence/release-evidence-archive.v1.json", "scripts/test/g01-oras-lock.test.mjs", "scripts/ci/run-actionlint.sh", "config/tool-locks/actionlint-v1.7.12.json", "scripts/ci/run-oras.sh", "config/tool-locks/oras-v1.3.3.json", ".omx/context/release-2-5-0-archive-authority.json",
];

function exactArray(actual, expected, label) {
  assert.ok(Array.isArray(actual) && actual.length > 0, `${label} must be nonempty`);
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
  assert.deepEqual(actual, expected, `${label} does not match the frozen canonical catalog`);
}

function validSelection(facts) {
  const selection = facts.selection;
  if (!selection || selection.status !== "SELECTED_GREEN" || facts.f11Status !== "GREEN" || facts.remoteDeleted !== true) return false;
  if (![facts.mergeSha, facts.developSha, facts.baseSha, facts.originSha, selection.terminalDevelopSha].every((sha) => sha === facts.mergeSha)) return false;
  const times = [facts.f7At, facts.f9At, facts.mergeAt, facts.deletionAt, facts.f11At, selection.createdAt].map(Date.parse);
  if (times.some((time) => !Number.isFinite(time))) return false;
  if (!(times[0] < times[1] && times[1] < times[2] && times[2] <= times[3] && times[3] <= times[4] && times[4] < times[5])) return false;
  const ancestors = facts.ancestors ?? [];
  if (selection.terminalKind === "direct-canonical") return ancestors.length === 0;
  if (selection.terminalKind !== "landed-recovery" || ancestors.length === 0) return false;
  if (facts.parentSha !== ancestors.at(-1).terminalDevelopSha) return false;
  let previous = -Infinity;
  const seen = new Set();
  for (const ancestor of ancestors) {
    const time = Date.parse(ancestor.failedAt);
    if (!Number.isFinite(time) || time <= previous || time >= times[0] || seen.has(ancestor.terminalDevelopSha)) return false;
    previous = time; seen.add(ancestor.terminalDevelopSha);
  }
  return true;
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
