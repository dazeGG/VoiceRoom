import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  DISABLED,
  HARD_FAIL,
  READY,
  evaluateProductionAuthority,
  readProductionPolicy,
  scanForCommittedProductionSecretExpressions,
} from "../deploy/check-production-environment.mjs";
import { revalidateApprovedPromotion } from "../deploy/revalidate-approved-promotion.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const sha = (character) => character.repeat(40);

function readySnapshot(overrides = {}) {
  return {
    mode: "synthetic-ready",
    repository: { fullName: "dazeGG/VoiceRoom" },
    dispatchRef: "refs/tags/v2.5.0",
    annotatedTagObjectSha: sha("a"),
    peeledCommitSha: sha("b"),
    verifiedMainReleaseMergeSha: sha("b"),
    workflowPath: ".github/workflows/promote-production-digests.yml",
    workflowBlobSha: sha("c"),
    reusableWorkflowDigest: digest("d"),
    githubWorkflowRef: "dazeGG/VoiceRoom/.github/workflows/promote-production-digests.yml@refs/tags/v2.5.0",
    githubWorkflowSha: sha("c"),
    appDigests: { api: digest("1"), web: digest("2"), worker: digest("3") },
    environment: {
      name: "production",
      protected_branches: false,
      custom_branch_policies: true,
      selectedTags: ["v2.5.0"],
    },
    requiredReviewerActorIds: [101, 202],
    preventSelfReview: true,
    canAdminsBypass: false,
    dispatcherActorId: 303,
    permissions: {
      contents: "read",
      packages: "read",
      deployments: "write",
      "id-token": "none",
    },
    ...overrides,
  };
}

test("G12-A01 disables live pretag, zero-environment and possible secret metadata without blocking publication", () => {
  assert.equal(evaluateProductionAuthority({ mode: "live-pretag" }).status, DISABLED);
  assert.equal(evaluateProductionAuthority({ mode: "live-pretag", productionEnvironmentStatus: 404 }).status, DISABLED);
  const possible = evaluateProductionAuthority({ possibleSecretMetadata: true });
  assert.equal(possible.status, DISABLED);
  assert.equal(possible.scheduleEnvironmentJob, false);
  assert.equal(possible.readsSecrets, false);
});

test("G12-A01 treats committed secret expressions or runtime reads as hard failures", () => {
  assert.deepEqual(scanForCommittedProductionSecretExpressions({
    ".github/workflows/bad.yml": "key: ${{ secrets.PRODUCTION_SSH_KEY }}",
  }), [".github/workflows/bad.yml"]);
  assert.equal(evaluateProductionAuthority({ committedSecretExpression: true }).status, HARD_FAIL);
  assert.equal(evaluateProductionAuthority({ runtimeSecretRead: true }).status, HARD_FAIL);
});

test("G12-A01 validates only exact synthetic future tag routing", () => {
  const ready = evaluateProductionAuthority(readySnapshot());
  assert.equal(ready.status, READY);
  for (const mutation of [
    { dispatchRef: "refs/heads/main" },
    { annotatedTagObjectSha: "" },
    { peeledCommitSha: sha("e") },
    { githubWorkflowSha: sha("f") },
    { appDigests: { api: "latest", web: digest("2"), worker: digest("3") } },
    { environment: { name: "production", protected_branches: false, custom_branch_policies: true, selectedTags: ["v*"] } },
    { preventSelfReview: false },
    { canAdminsBypass: true },
    { dispatcherActorId: 101 },
    { permissions: { contents: "read", packages: "read", deployments: "write", "id-token": "write" } },
  ]) assert.equal(evaluateProductionAuthority(readySnapshot(mutation)).status, DISABLED);
});

test("post-approval revalidation allows only immediate credential step after unchanged authority", () => {
  const snapshot = readySnapshot();
  assert.equal(revalidateApprovedPromotion({ preApproval: snapshot, postApproval: snapshot, nextStep: "consume-environment-credentials" }).credentialStepAllowed, true);
  assert.throws(() => revalidateApprovedPromotion({ preApproval: snapshot, postApproval: readySnapshot({ workflowBlobSha: sha("f"), githubWorkflowSha: sha("f") }), nextStep: "consume-environment-credentials" }), /policy drift|not ready/);
  assert.throws(() => revalidateApprovedPromotion({ preApproval: snapshot, postApproval: snapshot, nextStep: "wait" }), /credential step/);
});

test("workflows expose no ordinary production deploy and manual preflight is credentialless", () => {
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const promote = fs.readFileSync(".github/workflows/promote-production-digests.yml", "utf8");
  assert.doesNotMatch(ci, /appleboy\/ssh-action|secrets\.SSH_|docker compose up -d --build|deploy-production/);
  assert.match(promote, /^on:\n  workflow_dispatch:/m);
  assert.match(promote, /^permissions: \{\}$/m);
  assert.match(promote, /^      actions: read$/m);
  assert.match(promote, /^      contents: read$/m);
  assert.match(promote, /^      deployments: read$/m);
  assert.match(promote, /^      packages: read$/m);
  assert.match(promote, /^      id-token: none$/m);
  assert.doesNotMatch(promote, /environment:\s*production|secrets\.|ssh|OIDC|id-token: write/i);
  assert.equal(readProductionPolicy().defaultStatus, DISABLED);
});
