#!/usr/bin/env node
import assert from "node:assert/strict";
if(process.argv.includes("--fixture")){const i=process.argv.indexOf("--fixture"); assert.equal(process.argv[i+1],"bootstrap"); const e={schemaVersion:1,goal:"G01",phase:"F7",status:"GREEN",sourceSha:"a".repeat(40),digest:"sha256:"+"b".repeat(64)}; assert.match(e.digest,/^sha256:[0-9a-f]{64}$/); console.log("bootstrap envelope fixture: PASS")} else throw new Error("only --fixture bootstrap is supported during G01");
