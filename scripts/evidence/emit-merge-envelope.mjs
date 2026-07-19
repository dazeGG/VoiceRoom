#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { compactDigest } from "./export-goal-evidence.mjs";

export function buildMergeEnvelope(f7, f9, authority) {
  assert.equal(f7.goal, "G02"); assert.equal(f9.goal, "G02");
  assert.equal(f9.f7Digest, f7.digest); assert.equal(f7.sourceSha, f9.sourceSha);
  assert.equal(authority.remoteDeleted, true, "remote deletion must be authenticated");
  assert.equal(authority.terminalDevelopSha, authority.mergeSha, "terminal develop SHA must equal merge SHA");
  assert.equal(authority.postMergeRun?.headSha, authority.mergeSha);
  assert.equal(authority.postMergeRun?.event, "push");
  assert.ok(Date.parse(f9.createdAt) < Date.parse(authority.mergedAt));
  assert.ok(Date.parse(authority.mergedAt) <= Date.parse(authority.remoteDeletionObservedAt));
  assert.ok(Date.parse(authority.remoteDeletionObservedAt) <= Date.parse(authority.createdAt));
  const core = {
    schemaVersion: 1, goal: "G02", phase: "F11", status: "GREEN",
    evidenceId: "merge-envelope.g02.json", attemptId: f7.attemptId,
    sourceBranch: f7.sourceBranch, sourceSha: authority.mergeSha,
    f7Digest: f7.digest, f9Digest: f9.digest,
    mergeSha: authority.mergeSha, terminalDevelopSha: authority.terminalDevelopSha,
    remoteDeleted: true, mergedAt: authority.mergedAt,
    remoteDeletionObservedAt: authority.remoteDeletionObservedAt,
    prNumber: authority.prNumber, postMergeRun: authority.postMergeRun,
    createdAt: authority.createdAt,
  };
  return { ...core, digest: compactDigest(core) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const f7 = JSON.parse(fs.readFileSync(arg("--f7"))); const f9 = JSON.parse(fs.readFileSync(arg("--f9")));
  const authority = JSON.parse(fs.readFileSync(arg("--authority")));
  fs.writeFileSync(arg("--output"), `${JSON.stringify(buildMergeEnvelope(f7, f9, authority))}\n`);
}
