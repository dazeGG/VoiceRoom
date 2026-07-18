import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyBootstrap, validateRecoveryFixture, G01_WRITABLE, RECOVERY_WRITABLE, RECOVERY_READ_ONLY } from "../evidence/recover-landed-bootstrap.mjs";

const fixture = JSON.parse(fs.readFileSync("scripts/test/fixtures/g01-landed-bootstrap-recovery.json", "utf8"));

test("frozen recovery catalogs are exact, nonempty, unique and disjoint", () => {
  validateRecoveryFixture(fixture);
  assert.equal(G01_WRITABLE.length, 36);
  assert.equal(RECOVERY_WRITABLE.length, 17);
  assert.equal(RECOVERY_READ_ONLY.length, 22);
});

test("four-state classification rejects forged chronology and terminal SHAs", () => {
  for (const fixtureCase of fixture.cases) assert.equal(classifyBootstrap(fixtureCase.facts), fixtureCase.expected, fixtureCase.name);
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
