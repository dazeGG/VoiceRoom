#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateProductionAuthority, READY } from "./check-production-environment.mjs";

export function planProductionPromotion(authority) {
  const result = evaluateProductionAuthority(authority);
  if (result.status !== READY) return result;
  return {
    ...result,
    steps: ["revalidate-approved-policy", "consume-environment-credentials"],
    externalExecution: false,
  };
}

function main(argv = process.argv.slice(2)) {
  const authorityIndex = argv.indexOf("--authority");
  if (authorityIndex === -1 || !argv[authorityIndex + 1]) throw new Error("usage: promote-production-digests.mjs --authority FILE");
  const result = planProductionPromotion(JSON.parse(fs.readFileSync(argv[authorityIndex + 1], "utf8")));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== READY) process.exit(78);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
