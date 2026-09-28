// Runtime heartbeats over a migrated database: a heartbeat upserts one row per
// runtime, only rows fresher than the window are listed, and remove drops one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeReadinessRepository } from '../src/platform/runtime-readiness-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('heartbeats upsert per runtime, list only fresh rows and can be removed', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const repository = createRuntimeReadinessRepository({ client: pool });

  await repository.heartbeat({
    kind: 'api',
    id: ' api-1 ',
    capabilityTokens: ['b', 'a', 'a', ' ', 7],
    manifestDigest: 'sha256:one',
    manifestSchemaVersion: 1,
    contractVersion: 'voice-room.capabilities/v1',
    publicCapabilities: ['historyCursor'],
    ready: true
  });
  await repository.heartbeat({ kind: 'api', id: 'api-1', manifestDigest: 'sha256:two', ready: false });
  await repository.heartbeat({ kind: 'api', id: 'api-2', ready: true });
  await repository.heartbeat({ kind: 'worker', id: 'worker-1', capabilityTokens: ['media-processing.G77'] });

  const fresh = await repository.listFresh('api', { maxAgeMs: 60_000 });
  assert.deepEqual(
    fresh.map(({ id, manifestDigest, capabilityTokens, public: publicCaps, ready }) => ({
      id,
      manifestDigest,
      capabilityTokens,
      public: publicCaps,
      ready
    })),
    [
      { id: 'api-1', manifestDigest: 'sha256:two', capabilityTokens: [], public: [], ready: false },
      { id: 'api-2', manifestDigest: null, capabilityTokens: [], public: [], ready: true }
    ],
    'the second heartbeat replaced the first row; the worker is another kind'
  );
  assert.deepEqual(
    (await repository.listFresh('worker', { maxAgeMs: 60_000 })).map((row) => row.capabilityTokens),
    [['media-processing.G77']]
  );

  await pool.query(
    "UPDATE capability_runtime_heartbeats SET updated_at = current_timestamp - interval '1 minute' WHERE runtime_id = 'api-2'"
  );
  assert.deepEqual(
    (await repository.listFresh('api', { maxAgeMs: 30_000 })).map((row) => row.id),
    ['api-1'],
    'a heartbeat older than the window is not fresh'
  );

  await repository.remove('api', 'api-1');
  assert.deepEqual(
    (await repository.listFresh('api', { maxAgeMs: 120_000 })).map((row) => row.id),
    ['api-2']
  );
});

test('the first heartbeat normalises tokens and keeps the schema version as a number', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const repository = createRuntimeReadinessRepository({ client: pool });

  await repository.heartbeat({
    kind: 'api',
    id: 'api-1',
    capabilityTokens: ['b', 'a', 'a', ' ', 7],
    publicCapabilities: ['reactions', 'historyCursor'],
    manifestSchemaVersion: 1
  });
  const [row] = await repository.listFresh('api', { maxAgeMs: 60_000 });
  assert.deepEqual(row?.capabilityTokens, ['a', 'b']);
  assert.deepEqual(row?.public, ['historyCursor', 'reactions']);
  assert.equal(row?.manifestSchemaVersion, 1);
  assert.ok(row?.updatedAt instanceof Date);
});

test('an unknown runtime kind or an empty id is refused before touching the database', async () => {
  const repository = createRuntimeReadinessRepository({ client: { query: async () => assert.fail('no query') } });
  await assert.rejects(repository.heartbeat({ kind: 'other' as 'api', id: 'x' }), /kind is invalid/);
  await assert.rejects(repository.heartbeat({ kind: 'api', id: '  ' }), /id is required/);
});
