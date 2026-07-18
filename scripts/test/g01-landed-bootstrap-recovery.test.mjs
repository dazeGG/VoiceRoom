import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
const f=JSON.parse(fs.readFileSync("scripts/test/fixtures/g01-landed-bootstrap-recovery.json"));
const classify=x=>!x.firstAuthoritativeId?"G01_PRE_BRANCH":!x.mergeSha?"G01_PREMERGE_ACTIVE":!x.selection?"G01_LANDED_UNSEALED":x.selection.status==="SELECTED_GREEN"&&x.selection.terminalDevelopSha===x.mergeSha?"G01_SELECTED_GREEN":"G01_LANDED_UNSEALED";
test("four states are total and disjoint",()=>{for(const c of f.cases) assert.equal(classify(c.facts),c.expected)});
test("recovery catalog is contained and lineage stays absent",()=>{assert.ok(f.recoveryWritable.every(p=>f.g01Writable.includes(p)));assert.ok(!f.recoveryWritable.includes("docs/releases/2.5.0/evidence/bootstrap-lineage.json"))});
