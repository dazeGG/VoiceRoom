'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  INTERNAL_NODE_KEYS,
  OPERATOR_KEYS,
  PUBLIC_CAPABILITY_KEYS,
  normalizeManifest
} = require('@voice-room/shared/capabilities');
const { createCapabilitySnapshot } = require('../src/platform/capability-routes');
const { createReadinessReport, sha256Hex } = require('../src/platform/readiness');

const manifestPath = path.resolve(process.env.CAPABILITY_DAG_PATH || 'config/capability-dag.v1.json');

function fullOptions(manifest) {
  const categories = ['binary', 'schema', 'index', 'config', 'api', 'web', 'visibility', 'worker', 'internal'];
  const options = {
    desired: Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, true]))
  };
  for (const category of categories) {
    options[`${category}Ready`] = [...new Set(manifest.publicKeys.flatMap((node) => node.requires[category]))];
  }
  return options;
}

function tempManifest(mutator) {
  const candidate = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mutator(candidate);
  const dir = mkdtempSync(path.join(tmpdir(), 'voiceroom-g14-'));
  const target = path.join(dir, 'manifest.json');
  writeFileSync(target, `${JSON.stringify(candidate, null, 2)}\n`);
  return target;
}

test('G14-A01 canonical manifest has exact 9/10/15 nodes and fail-closed defaults', () => {
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = normalizeManifest(JSON.parse(raw));
  assert.ok(manifest);
  assert.equal(manifest.publicKeys.length, 9);
  assert.equal(manifest.internalPrerequisites.length, 10);
  assert.equal(manifest.operatorFlags.length, 15);
  assert.deepEqual(manifest.publicKeys.map(({ key }) => key), PUBLIC_CAPABILITY_KEYS);
  assert.deepEqual(manifest.internalPrerequisites.map(({ key }) => key), INTERNAL_NODE_KEYS);
  assert.deepEqual(manifest.operatorFlags.map(({ key }) => key), OPERATOR_KEYS);

  const disabled = createReadinessReport(manifestPath);
  assert.deepEqual(disabled.features, Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, false])));
  assert.equal(disabled.manifest.digest, sha256Hex(raw));
  assert.equal(disabled.manifest.schemaVersion, 1);
});

test('G14-A02 complete readiness is exposed publicly without private operator flags', () => {
  const manifest = normalizeManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const report = createReadinessReport(manifestPath, fullOptions(manifest));
  assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => report.features[key] === true));
  assert.equal(report.replicaConsensus, true);

  const payload = createCapabilitySnapshot(report);
  assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => payload.features[key] === true));
  assert.equal('operatorFlags' in payload, false);
  assert.doesNotMatch(JSON.stringify(payload), /op\./);
});

test('G14-A02 missing prerequisite and replica heartbeat/digest mismatch make every public key false', () => {
  const manifest = normalizeManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const options = fullOptions(manifest);
  options.binaryReady = options.binaryReady.filter((token) => token !== 'api.history.v1');
  const missing = createReadinessReport(manifestPath, options);
  assert.equal(missing.features.historyCursor, false);
  assert.equal(missing.features.readCursor, false);

  const green = createReadinessReport(manifestPath, fullOptions(manifest));
  const replicaBase = {
    id: 'api-2',
    manifestDigest: green.manifest.digest,
    manifestSchemaVersion: 1,
    contractVersion: 'voice-room.capabilities/v1',
    public: green.features
  };
  for (const replica of [replicaBase, { ...replicaBase, ready: true, manifestDigest: 'sha256:stale' }]) {
    const report = createReadinessReport(manifestPath, { ...fullOptions(manifest), replicas: [replica] });
    assert.equal(report.replicaConsensus, false);
    assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => report.features[key] === false));
  }
});

test('G14-A02 rejects missing schema, unknown nodes, missing edges and cycles', () => {
  const invalidPaths = [
    tempManifest((value) => { delete value.schemaVersion; }),
    tempManifest((value) => { value.publicKeys[0].key = 'unknown'; }),
    tempManifest((value) => { value.publicKeys[0].dependsOn = ['missing']; }),
    tempManifest((value) => {
      value.publicKeys[0].dependsOn = ['readCursor'];
      value.publicKeys[1].dependsOn = ['historyCursor'];
    })
  ];
  for (const target of invalidPaths) {
    assert.throws(() => createReadinessReport(target), /Invalid capability manifest/);
  }
});
