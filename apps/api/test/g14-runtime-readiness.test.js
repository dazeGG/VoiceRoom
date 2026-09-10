'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const test = require('node:test');
const { normalizeManifest, PUBLIC_CAPABILITY_KEYS } = require('@voice-room/shared/capabilities');
const { runMigrations } = require('../src/lib/migrate');
const { createReadinessReport } = require('../src/platform/readiness');
const { createRuntimeReadinessProvider } = require('../src/platform/runtime-readiness');
const { createRuntimeReadinessRepository } = require('../src/platform/runtime-readiness-repository');
const { WORKER_CAPABILITIES, startWorkerHeartbeat } = require('../src/platform/worker-heartbeat');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const manifestPath = path.resolve(__dirname, '../../../config/capability-dag.v1.json');

function fullOptions() {
  const manifest = normalizeManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const options = { desired: Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, true])) };
  for (const category of ['binary', 'schema', 'index', 'config', 'api', 'web', 'visibility', 'worker', 'internal']) {
    options[`${category}Ready`] = [...new Set(manifest.publicKeys.flatMap((node) => node.requires[category]))];
  }
  return options;
}

test('G14-A02 production replica consensus never fabricates a missing heartbeat', () => {
  const report = createReadinessReport(manifestPath, {
    ...fullOptions(),
    requireReplicaConsensus: true,
    replicas: []
  });
  assert.equal(report.replicaConsensus, false);
  assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => report.features[key] === false));
});

test('G14-A02 live worker and API heartbeats gate runtime readiness fail closed', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 120_000
}, async (t) => {
  const database = await createTestDatabase(t);
  await runMigrations({ databaseUrl: database.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: database.databaseUrl, max: 3 });
  t.after(async () => { await pool.end(); await database.cleanup(); });
  const repository = createRuntimeReadinessRepository({ client: pool });
  const workerHeartbeats = [];
  for (const workerName of Object.keys(WORKER_CAPABILITIES)) {
    workerHeartbeats.push(await startWorkerHeartbeat({
      env: {
        CAPABILITY_HEARTBEAT_INTERVAL_MS: '60000',
        CAPABILITY_RUNTIME_ID: `${workerName}-1`,
        DATABASE_URL: database.databaseUrl
      },
      workerName
    }));
  }
  t.after(async () => {
    await Promise.all(workerHeartbeats.splice(0).map((heartbeat) => heartbeat.close()));
  });

  const provider = createRuntimeReadinessProvider({
    expectedApiReplicaIds: ['api-1', 'api-2'],
    getClient: () => pool,
    getReadinessOptions: fullOptions,
    heartbeatIntervalMs: 60_000,
    heartbeatMaxAgeMs: 15_000,
    manifestPath,
    runtimeId: 'api-1'
  });
  t.after(() => provider.stop());

  await provider.refresh();
  assert.equal(provider.getSnapshot().replicaConsensus, false, 'missing expected API replica must fail closed');

  const local = createReadinessReport(manifestPath, fullOptions());
  await repository.heartbeat({
    kind: 'api',
    id: 'api-2',
    manifestDigest: local.manifest.digest,
    manifestSchemaVersion: local.manifest.schemaVersion,
    contractVersion: local.manifest.contractVersion,
    publicCapabilities: PUBLIC_CAPABILITY_KEYS,
    ready: true
  });
  await provider.refresh();
  assert.equal(provider.getSnapshot().replicaConsensus, true);
  assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => provider.getSnapshot().features[key] === true));

  await Promise.all(workerHeartbeats.splice(0).map((heartbeat) => heartbeat.close()));
  await provider.refresh();
  assert.equal(provider.getSnapshot().features.engagement, false, 'missing delivery heartbeat disables engagement');
  assert.equal(provider.getSnapshot().features.mediaUploads, false, 'missing media heartbeat disables uploads');

  await repository.heartbeat({ kind: 'worker', id: 'worker-set-1', capabilityTokens: Object.values(WORKER_CAPABILITIES).flat(), ready: true });
  await repository.heartbeat({
    kind: 'api',
    id: 'api-2',
    manifestDigest: '0'.repeat(64),
    manifestSchemaVersion: local.manifest.schemaVersion,
    contractVersion: local.manifest.contractVersion,
    publicCapabilities: PUBLIC_CAPABILITY_KEYS,
    ready: true
  });
  await provider.refresh();
  assert.equal(provider.getSnapshot().replicaConsensus, false, 'manifest disagreement disables every public capability');
  assert.ok(PUBLIC_CAPABILITY_KEYS.every((key) => provider.getSnapshot().features[key] === false));
});
