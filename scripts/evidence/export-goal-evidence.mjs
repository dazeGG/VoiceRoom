#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SELECTION_KEYS = [
  "schemaVersion", "release", "evidenceId", "attemptId", "terminalKind",
  "f7Id", "f7Digest", "f9Id", "f9Digest", "f11Id", "f11Digest",
  "terminalDevelopSha", "createdAt", "remoteDeleted", "status",
  "ancestorFailures", "bootstrapSupersessionChainDigest", "artifactBindings",
  "selectionDigest",
];

export function compactDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function bytesDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys must be exact`);
}

function canonicalInstant(value, label) {
  assert.equal(typeof value, "string", `${label} must be a timestamp`);
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time) && new Date(time).toISOString() === value, `${label} must be canonical UTC`);
  return time;
}

function validateBinding(value, label) {
  exactKeys(value, ["artifactId", "artifactName", "runId", "runAttempt", "headSha", "archiveDigest", "payloadDigest"], `${label} binding`);
  assert.ok(Number.isInteger(value.artifactId) && value.artifactId > 0, `${label} artifact id is invalid`);
  assert.ok(Number.isInteger(value.runId) && value.runId > 0, `${label} run id is invalid`);
  assert.ok(Number.isInteger(value.runAttempt) && value.runAttempt > 0, `${label} run attempt is invalid`);
  assert.match(value.headSha, SHA); assert.match(value.archiveDigest, DIGEST); assert.match(value.payloadDigest, DIGEST);
  assert.ok(typeof value.artifactName === "string" && value.artifactName.length > 0, `${label} artifact name is invalid`);
}

function validateEnvelopeBindings(selection, envelopes) {
  if (!envelopes) return;
  for (const phase of ["f7", "f9", "f11"]) {
    const envelope = envelopes[phase];
    assert.ok(envelope && typeof envelope === "object", `terminal ${phase.toUpperCase()} payload is missing`);
    assert.equal(envelope.status, "GREEN", `terminal ${phase.toUpperCase()} is red or invalid`);
    assert.equal(envelope.evidenceId, selection[`${phase}Id`], `${phase.toUpperCase()} evidence id mismatch`);
    assert.equal(envelope.digest, selection[`${phase}Digest`], `${phase.toUpperCase()} digest mismatch`);
  }
  assert.equal(envelopes.f9.f7Digest, envelopes.f7.digest, "F9 does not bind F7");
  assert.equal(envelopes.f11.f7Digest, envelopes.f7.digest, "F11 does not bind F7");
  assert.equal(envelopes.f11.f9Digest, envelopes.f9.digest, "F11 does not bind F9");
  assert.equal(envelopes.f11.remoteDeleted, true, "terminal F11 remote deletion is not sealed");
  assert.equal(envelopes.f11.terminalDevelopSha, selection.terminalDevelopSha, "terminal F11 SHA mismatch");
}

function recomputeEnvelopeDigest(phase, envelope, download) {
  if (phase === "f7") {
    assert.ok(download.candidateReport, "F7 candidate report is missing");
    return compactDigest({
      candidateReport: download.candidateReport,
      baseSha: envelope.baseSha,
      sourceSha: envelope.sourceSha,
      producerRun: envelope.producerRun,
      requiredGates: envelope.requiredGates,
      verification: envelope.verification,
    });
  }
  if (phase === "f9") return compactDigest(envelope.reviewObjects);
  return compactDigest({ prNumber: envelope.prNumber, mergeSha: envelope.mergeSha, postMergeRun: envelope.postMergeRun });
}

export function validateArtifactDownloads(selection, envelopes, downloads, repository) {
  assert.match(repository, /^[^/]+\/[^/]+$/, "repository is invalid");
  for (const phase of ["f7", "f9", "f11"]) {
    const binding = selection.artifactBindings[phase];
    const envelope = envelopes[phase];
    const download = downloads?.[phase];
    assert.ok(download, `${phase.toUpperCase()} download authority is missing`);
    const { metadata, run, archiveBytes, payloadBytes } = download;
    assert.equal(metadata?.id, binding.artifactId, `${phase.toUpperCase()} artifact id mismatch`);
    assert.equal(metadata?.name, binding.artifactName, `${phase.toUpperCase()} artifact name mismatch`);
    assert.equal(metadata?.expired, false, `${phase.toUpperCase()} artifact is expired`);
    assert.equal(metadata?.digest, binding.archiveDigest, `${phase.toUpperCase()} metadata archive digest mismatch`);
    assert.equal(metadata?.workflow_run?.id, binding.runId, `${phase.toUpperCase()} metadata run mismatch`);
    assert.equal(metadata?.workflow_run?.head_sha, binding.headSha, `${phase.toUpperCase()} metadata head mismatch`);
    assert.equal(bytesDigest(archiveBytes), binding.archiveDigest, `${phase.toUpperCase()} archive digest mismatch`);
    assert.equal(bytesDigest(payloadBytes), binding.payloadDigest, `${phase.toUpperCase()} payload digest mismatch`);
    assert.deepEqual(JSON.parse(payloadBytes), envelope, `${phase.toUpperCase()} downloaded payload mismatch`);
    assert.equal(run?.id, binding.runId, `${phase.toUpperCase()} producer run mismatch`);
    assert.equal(run?.run_attempt, binding.runAttempt, `${phase.toUpperCase()} producer attempt mismatch`);
    assert.equal(run?.head_sha, binding.headSha, `${phase.toUpperCase()} producer head mismatch`);
    assert.equal(run?.event, phase === "f11" ? "push" : "pull_request", `${phase.toUpperCase()} producer event mismatch`);
    assert.equal(run?.path, ".github/workflows/ci.yml", `${phase.toUpperCase()} producer workflow mismatch`);
    assert.equal(run?.repository?.full_name, repository, `${phase.toUpperCase()} producer repository mismatch`);
    assert.equal(run?.status, "completed", `${phase.toUpperCase()} producer is incomplete`);
    assert.equal(run?.conclusion, "success", `${phase.toUpperCase()} producer is not green`);
    assert.equal(envelope.digest, recomputeEnvelopeDigest(phase, envelope, download), `${phase.toUpperCase()} core digest mismatch`);
  }
  validateEnvelopeBindings(selection, envelopes);
  return envelopes;
}

export function validateBootstrapSelection(selection, context = {}) {
  assert.ok(selection, "missing selection authority");
  if (context.authorityPath?.endsWith("bootstrap-lineage.json")) throw new Error("tracked summary is never selection authority");
  exactKeys(selection, SELECTION_KEYS, "bootstrap selection");
  const core = { ...selection }; delete core.selectionDigest;
  assert.equal(selection.selectionDigest, compactDigest(core), "selection digest mismatch");
  assert.equal(selection.bootstrapSupersessionChainDigest, compactDigest(selection.ancestorFailures), "supersession digest mismatch");
  assert.equal(selection.schemaVersion, 1); assert.equal(selection.release, "2.5.0");
  assert.equal(selection.status, "SELECTED_GREEN", "red or unsealed selection");
  assert.equal(selection.remoteDeleted, true, "remote deletion is not sealed");
  assert.match(selection.terminalDevelopSha, SHA); assert.match(selection.selectionDigest, DIGEST);
  canonicalInstant(selection.createdAt, "selection createdAt");
  assert.ok(Number.isInteger(context.selectionArtifactId) && context.selectionArtifactId > 0, "external selection artifact id is required");
  assert.ok(Array.isArray(selection.ancestorFailures), "ancestor failures must be an array");
  for (const [index, ancestor] of selection.ancestorFailures.entries()) {
    assert.match(ancestor.terminalDevelopSha, SHA, `ancestor ${index} terminal SHA is invalid`);
    assert.match(ancestor.digest, DIGEST, `ancestor ${index} digest is invalid`);
  }
  for (const phase of ["f7", "f9", "f11"]) {
    assert.match(selection[`${phase}Digest`], DIGEST); validateBinding(selection.artifactBindings?.[phase], phase.toUpperCase());
  }
  assert.equal(selection.artifactBindings.f7.headSha, selection.artifactBindings.f9.headSha, "F7/F9 head mismatch");
  assert.equal(selection.artifactBindings.f11.headSha, selection.terminalDevelopSha, "F11 binding is not terminal");
  if (selection.terminalKind === "direct-canonical") {
    assert.equal(selection.ancestorFailures.length, 0, "direct selection cannot contain recovery ancestors");
    assert.match(selection.attemptId, /^g01-a[0-9]{2,}$/);
  } else {
    assert.equal(selection.terminalKind, "landed-recovery", "unknown terminal selection kind");
    assert.ok(selection.ancestorFailures.length > 0, "recovery selection requires ancestors");
    assert.match(selection.attemptId, /^g01-recovery-a(?:0[2-9]|[1-9][0-9]+)$/);
  }
  const unsealed = new Set(selection.ancestorFailures.flatMap((value) => [value.terminalDevelopSha, value.headSha]));
  if (context.headSha && unsealed.has(context.headSha)) throw new Error("unsealed ancestor cannot admit G02");
  assert.equal(context.headSha, selection.terminalDevelopSha, "stale local head");
  assert.equal(context.originDevelopSha, selection.terminalDevelopSha, "stale origin/develop");
  validateEnvelopeBindings(selection, context.envelopes);
  return selection;
}

export function buildGoalEvidence(input) {
  validateBootstrapSelection(input.selection, {
    selectionArtifactId: input.selectionArtifactId,
    headSha: input.baseSha,
    originDevelopSha: input.baseSha,
  });
  assert.equal(input.sourceBranch, "feature/2.5.0-g02-autonomous-ci-foundation");
  assert.match(input.sourceSha, SHA); assert.match(input.baseSha, SHA);
  assert.equal(input.producerRun?.headSha, input.sourceSha);
  assert.equal(input.verification?.chromiumRuns, 2); assert.equal(input.verification?.retries, 0);
  assert.equal(input.verification?.teardown, "passed"); assert.match(input.verification?.reportDigest, DIGEST);
  const core = {
    schemaVersion: 1, goal: "G02", phase: "F7", status: "GREEN",
    evidenceId: "ci-bundle.g02.json", attemptId: "g02",
    sourceBranch: input.sourceBranch, baseSha: input.baseSha, sourceSha: input.sourceSha,
    selection: { artifactId: input.selectionArtifactId, evidenceId: input.selection.evidenceId, digest: input.selection.selectionDigest, terminalDevelopSha: input.selection.terminalDevelopSha },
    producerRun: input.producerRun, requiredGates: input.requiredGates,
    verification: input.verification, createdAt: input.createdAt,
  };
  canonicalInstant(core.createdAt, "F7 createdAt");
  return { ...core, digest: compactDigest(core) };
}

function argument(name, optional = false) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (optional) return undefined;
  throw new Error(`missing ${name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--validate-selection")) {
    const selection = JSON.parse(fs.readFileSync(argument("--selection")));
    const read = (name) => JSON.parse(fs.readFileSync(argument(name)));
    const envelopes = process.argv.includes("--f7") ? { f7: read("--f7"), f9: read("--f9"), f11: read("--f11") } : undefined;
    validateBootstrapSelection(selection, {
      selectionArtifactId: Number(argument("--selection-artifact-id")),
      headSha: argument("--head-sha"), originDevelopSha: argument("--origin-develop-sha"),
      authorityPath: argument("--selection"),
      envelopes,
    });
    if (envelopes) {
      const downloads = Object.fromEntries(["f7", "f9", "f11"].map((phase) => [phase, {
        metadata: read(`--${phase}-metadata`),
        run: read(`--${phase}-run`),
        archiveBytes: fs.readFileSync(argument(`--${phase}-archive`)),
        payloadBytes: fs.readFileSync(argument(`--${phase}`)),
        ...(phase === "f7" ? { candidateReport: read("--f7-report") } : {}),
      }]));
      validateArtifactDownloads(selection, envelopes, downloads, argument("--repository"));
    }
    process.stdout.write("G02 bootstrap selection: PASS\n");
  } else if (process.argv.includes("--emit-f7")) {
    const input = JSON.parse(fs.readFileSync(argument("--input")));
    fs.writeFileSync(argument("--output"), `${JSON.stringify(buildGoalEvidence(input))}\n`);
  } else throw new Error("expected --validate-selection or --emit-f7");
}
