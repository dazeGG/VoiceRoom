import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { classifyBootstrap, validateRecoveryFixture, G01_WRITABLE, RECOVERY_WRITABLE, RECOVERY_READ_ONLY } from "../evidence/recover-landed-bootstrap.mjs";
import { validateBootstrapFailure } from "../evidence/emit-bootstrap-selection.mjs";

const fixture = JSON.parse(fs.readFileSync("scripts/test/fixtures/g01-landed-bootstrap-recovery.json", "utf8"));

test("frozen recovery catalogs are exact, nonempty, unique and disjoint", () => {
  validateRecoveryFixture(fixture);
  assert.equal(G01_WRITABLE.length, 36);
  assert.equal(RECOVERY_WRITABLE.length, 17);
  assert.equal(RECOVERY_READ_ONLY.length, 22);
});

test("four-state classification rejects forged chronology and terminal SHAs", () => {
  for (const fixtureCase of fixture.cases) assert.equal(classifyBootstrap(fixtureCase.facts), fixtureCase.expected, fixtureCase.name);
  const direct = structuredClone(fixture.cases.find((fixtureCase) => fixtureCase.name === "direct-selected").facts);
  direct.selection.attemptId = "g01-a99";
  assert.equal(classifyBootstrap(direct), "G01_LANDED_UNSEALED", "non-canonical direct attempt ID must fail closed");
  const redigest = (facts, mutate) => { const copy = structuredClone(facts); mutate(copy.selection); const core = { ...copy.selection }; delete core.selectionDigest; copy.selection.selectionDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex")}`; return copy; };
  for (const hostile of [
    redigest(fixture.cases.find((item) => item.name === "direct-selected").facts, (selection) => { selection.artifactBindings.f7.artifactName = "g01-approval-g01-a02-run-10-attempt-1-head-" + "a".repeat(40); }),
    redigest(fixture.cases.find((item) => item.name === "direct-selected").facts, (selection) => { [selection.artifactBindings.f7, selection.artifactBindings.f9] = [selection.artifactBindings.f9, selection.artifactBindings.f7]; }),
    redigest(fixture.cases.find((item) => item.name === "recovery-selected").facts, (selection) => { selection.terminalKind = "direct-canonical"; }),
  ]) assert.equal(classifyBootstrap(hostile), "G01_LANDED_UNSEALED", "artifact/terminal relabel must fail closed");
});

test("catalog mutations fail closed", () => {
  for (const mutate of [
    (copy) => { copy.recoveryWritable = []; },
    (copy) => { copy.recoveryWritable.push(copy.recoveryWritable[0]); },
    (copy) => { copy.recoveryWritable.push("docs/releases/2.5.0/evidence/bootstrap-lineage.json"); },
    (copy) => { copy.recoveryReadOnly.reverse(); },
  ]) {
    const copy = structuredClone(fixture); mutate(copy);
    assert.throws(() => validateRecoveryFixture(copy));
  }
});

test("landed-unsealed failure payload is exact, rerun-bound and rejects relabel/base/status mutations", () => {
  const failure = { schemaVersion: 1, release: "2.5.0", status: "G01_LANDED_UNSEALED", attemptId: "g01-a08", evidenceId: "bootstrap-failure.g01-a08.json", failedPhase: "F11", baseSha: "9".repeat(40), parentSha: "9".repeat(40), terminalDevelopSha: "b".repeat(40), headSha: "a".repeat(40), runId: 40, runAttempt: 2, createdAt: "2026-07-18T00:00:00.000Z", reason: "failed closed", recoveryLineage: [] };
  validateBootstrapFailure(failure);
  for (const mutate of [(x) => { x.evidenceId = "bootstrap-failure.g01-a09.json"; }, (x) => { x.parentSha = "8".repeat(40); }, (x) => { x.status = "SELECTED_GREEN"; }, (x) => { x.runAttempt = 0; }, (x) => { x.failedPhase = "F9"; }]) { const copy = structuredClone(failure); mutate(copy); assert.throws(() => validateBootstrapFailure(copy)); }
});
