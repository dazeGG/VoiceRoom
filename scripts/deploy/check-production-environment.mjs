#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const DISABLED = "PROMOTION_DISABLED_EXTERNAL_AUTHORITY";
export const READY = "PROMOTION_READY_EXTERNAL_AUTHORITY";
export const HARD_FAIL = "PROMOTION_HARD_FAILURE";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const SECRET_EXPR = /\$\{\{\s*secrets\.[A-Z0-9_]*(?:PROD|PRODUCTION|SSH|DEPLOY)[A-Z0-9_]*\s*\}\}/i;

export function readProductionPolicy(path = "config/deploy/production-environment-policy.v1.json") {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function disabled(reason) {
  return { status: DISABLED, reason, scheduleEnvironmentJob: false, readsSecrets: false, contactsProduction: false };
}

function hardFailure(reason) {
  return { status: HARD_FAIL, reason, scheduleEnvironmentJob: false, readsSecrets: false, contactsProduction: false };
}

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

export function scanForCommittedProductionSecretExpressions(files) {
  const offenders = [];
  for (const [file, text] of Object.entries(files)) if (SECRET_EXPR.test(text)) offenders.push(file);
  return offenders;
}

export function evaluateProductionAuthority(snapshot, policy = readProductionPolicy()) {
  if (snapshot?.committedSecretExpression === true || snapshot?.runtimeSecretRead === true)
    return hardFailure("committed or runtime production secret use is forbidden");
  if (snapshot?.possibleSecretMetadata === true) return disabled("possible production secret metadata is nonblocking external authority");
  if (policy.allowLivePromotionInThisRelease !== false) return disabled("live promotion is outside this release plan");
  if (snapshot?.mode !== "synthetic-ready") return disabled("pre-tag live production authority is disabled");
  const expectedWorkflowRef = `${policy.repository.fullName}/${policy.workflowPath}@refs/tags/${policy.requiredTag}`;
  const appDigests = snapshot.appDigests ?? {};
  const everyDigest = ["api", "web", "worker"].every((id) => DIGEST.test(appDigests[id] ?? ""));
  const ready = snapshot.repository?.fullName === policy.repository.fullName &&
    snapshot.dispatchRef === `refs/tags/${policy.requiredTag}` &&
    SHA.test(snapshot.annotatedTagObjectSha ?? "") &&
    SHA.test(snapshot.peeledCommitSha ?? "") &&
    snapshot.peeledCommitSha === snapshot.verifiedMainReleaseMergeSha &&
    snapshot.workflowPath === policy.workflowPath &&
    SHA.test(snapshot.workflowBlobSha ?? "") &&
    DIGEST.test(snapshot.reusableWorkflowDigest ?? "") &&
    snapshot.githubWorkflowRef === expectedWorkflowRef &&
    snapshot.githubWorkflowSha === snapshot.workflowBlobSha &&
    everyDigest &&
    snapshot.environment?.name === policy.environment &&
    snapshot.environment?.protected_branches === policy.environmentPolicy.protected_branches &&
    snapshot.environment?.custom_branch_policies === policy.environmentPolicy.custom_branch_policies &&
    same(snapshot.environment?.selectedTags, [policy.environmentPolicy.selectedTag]) &&
    Array.isArray(snapshot.requiredReviewerActorIds) &&
    snapshot.requiredReviewerActorIds.length > 0 &&
    snapshot.preventSelfReview === policy.environmentPolicy.prevent_self_review &&
    snapshot.canAdminsBypass === policy.environmentPolicy.can_admins_bypass &&
    Number.isInteger(snapshot.dispatcherActorId) &&
    !snapshot.requiredReviewerActorIds.includes(snapshot.dispatcherActorId) &&
    same(snapshot.permissions, policy.promotionPermissions);
  if (!ready) return disabled("exact future tag, workflow, policy, actor, digest or permission authority is absent");
  return {
    status: READY,
    reason: "synthetic ready routing fixture only",
    scheduleEnvironmentJob: true,
    readsSecrets: false,
    contactsProduction: false,
    appDigests,
  };
}

function main(argv = process.argv.slice(2)) {
  const fixtureIndex = argv.indexOf("--fixture");
  if (fixtureIndex === -1 || !argv[fixtureIndex + 1]) throw new Error("usage: check-production-environment.mjs --fixture FILE");
  const result = evaluateProductionAuthority(JSON.parse(fs.readFileSync(argv[fixtureIndex + 1], "utf8")));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === HARD_FAIL) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
