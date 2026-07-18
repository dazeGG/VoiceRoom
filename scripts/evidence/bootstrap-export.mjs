#!/usr/bin/env node
import fs from "node:fs"; import crypto from "node:crypto";
const file=process.argv[2]; if(!file) throw new Error("usage: bootstrap-export.mjs INPUT.json"); const b=fs.readFileSync(file); const o=JSON.parse(b); for(const k of ["reviewer","f9","mergeSha","deletion","f11","terminal","selection"]) if(k in o) throw new Error(`candidate predicts future field: ${k}`); process.stdout.write(JSON.stringify({sha256:crypto.createHash("sha256").update(b).digest("hex"),candidate:o})+"\\n");
