import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  RUNTIME_PUBLICATION_SEQUENCE,
  assertDeploymentComposeUsesDigests,
  assertRuntimePublicationRecord,
  buildRuntimePublicationRecord,
  readRuntimeConfig,
  validateRuntimeConfig,
} from "../oci/build-publish.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const sourceSha = "a".repeat(40);

function fixture(overrides = {}) {
  return {
    sourceSha,
    digests: { api: digest("1"), web: digest("2"), worker: digest("3"), musicbot: digest("a") },
    sboms: { api: digest("4"), web: digest("5"), worker: digest("6"), musicbot: digest("b") },
    provenance: { api: digest("7"), web: digest("8"), worker: digest("9"), musicbot: digest("c") },
    ...overrides,
  };
}

test("G11-A01 declares separate immutable runtime packages, SBOM and provenance", () => {
  const config = validateRuntimeConfig(readRuntimeConfig());
  assert.deepEqual(config.runtimePackages.map((row) => row.image), [
    "ghcr.io/dazegg/voiceroom-api",
    "ghcr.io/dazegg/voiceroom-web",
    "ghcr.io/dazegg/voiceroom-worker",
    "ghcr.io/dazegg/voiceroom-musicbot",
  ]);
  assert.equal(config.evidencePackage, "ghcr.io/dazegg/voiceroom-release-evidence");
  assert.equal(RUNTIME_PUBLICATION_SEQUENCE.includes("generate-sbom"), true);
  assert.equal(RUNTIME_PUBLICATION_SEQUENCE.includes("generate-provenance"), true);
});

test("G11-A01 records identical immutable digests for release-candidate and staging", () => {
  const config = readRuntimeConfig();
  const record = buildRuntimePublicationRecord({ config, ...fixture() });
  assertRuntimePublicationRecord(record, config);
  assert.deepEqual(record.environments["release-candidate"], record.environments.staging);
  assert.equal(record.evidencePackageUsed, false);
  assert.equal(record.deploymentHostBuild, false);
});

test("G11-A01 rejects tampered digests and missing SBOM/provenance", () => {
  const config = readRuntimeConfig();
  assert.throws(() => buildRuntimePublicationRecord({ config, ...fixture({ digests: { api: "latest", web: digest("2"), worker: digest("3"), musicbot: digest("a") } }) }), /immutable digest/);
  assert.throws(() => buildRuntimePublicationRecord({ config, ...fixture({ sboms: { api: digest("4"), worker: digest("6"), musicbot: digest("b") } }) }), /SBOM/);
  assert.throws(() => buildRuntimePublicationRecord({ config, ...fixture({ provenance: { api: digest("7"), web: digest("8"), worker: digest("9") } }) }), /provenance/);
});

test("deployment compose consumes digests and does not build on the host", () => {
  assertDeploymentComposeUsesDigests(fs.readFileSync("docker-compose.yml", "utf8"));
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  for (const target of ["api", "web", "worker", "musicbot"]) assert.match(dockerfile, new RegExp(` AS ${target}\\b`));
  assert.match(dockerfile, /COPY config \.\/config/, "API runtime image must contain the capability manifest");
});

test("G11 workflow contract has no deployment-host build or evidence archive publication", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /^  goal-g11-runtime-images:/m);
  assert.match(workflow, /scripts\/oci\/build-publish\.mjs --verify-config/);
  assert.doesNotMatch(workflow, /voiceroom-release-evidence.*goal-g11|goal-g11[\s\S]*appleboy\/ssh-action/);
});
