#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateProductionAuthority, READY } from "./check-production-environment.mjs";

export function revalidateApprovedPromotion({ preApproval, postApproval, nextStep }) {
  const before = evaluateProductionAuthority(preApproval);
  const after = evaluateProductionAuthority(postApproval);
  if (before.status !== READY || after.status !== READY) throw new Error("promotion authority is not ready");
  if (JSON.stringify(preApproval) !== JSON.stringify(postApproval)) throw new Error("policy drift after approval");
  if (nextStep !== "consume-environment-credentials") throw new Error("credential step must be immediate and sole");
  return {
    status: READY,
    credentialStepAllowed: true,
    envelope: "post-approval-policy-envelope.json",
  };
}

function main(argv = process.argv.slice(2)) {
  const fixtureIndex = argv.indexOf("--fixture");
  if (fixtureIndex === -1 || !argv[fixtureIndex + 1]) throw new Error("usage: revalidate-approved-promotion.mjs --fixture FILE");
  process.stdout.write(`${JSON.stringify(revalidateApprovedPromotion(JSON.parse(fs.readFileSync(argv[fixtureIndex + 1], "utf8"))))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
