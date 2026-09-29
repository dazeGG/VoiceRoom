// A worker container is restarted unless it was stopped, since a host reboot
// ends every worker with exit 0 and on-failure left them all down. A worker
// whose claims are off therefore stays up, idle and without a heartbeat, until
// it is stopped, instead of exiting into a restart loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { main } from '../src/workers/main.ts';
import { createRuntimeReadinessRepository } from '../src/platform/runtime-readiness-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const WORKERS = [
  'message-delivery',
  'notification-delivery',
  'media-processing',
  'media-maintenance',
  'media-reconciliation'
];

test('every worker service in compose comes back after a host reboot', () => {
  const compose = fs.readFileSync(path.join(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');
  for (const worker of WORKERS) {
    const start = compose.indexOf(`\n  ${worker}:\n`);
    assert.ok(start >= 0, `compose has no ${worker} service`);
    // A service block ends at the blank line before the next service.
    const block = compose.slice(start + 1, compose.indexOf('\n\n', start + 1));
    assert.match(block, /^ {4}restart: unless-stopped$/m, `${worker} must restart unless stopped`);
  }
});

test('a worker with claims off idles without a heartbeat until it is stopped', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const heartbeats = createRuntimeReadinessRepository({ client: pool });
  const controller = new AbortController();

  let settled = false;
  const running = main(
    {
      VOICE_ROOM_WORKER: 'message-delivery',
      MESSAGE_DELIVERY_CLAIM_ENABLED: 'false',
      DATABASE_URL: databaseUrl,
      WORKER_METRICS_HOST: '127.0.0.1',
      WORKER_METRICS_PORT: '0',
      LOG_LEVEL: 'silent'
    },
    { stopSignal: controller.signal }
  ).finally(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(settled, false, 'the disabled worker must not exit on its own');
  assert.deepEqual(
    await heartbeats.listFresh('worker', { maxAgeMs: 60_000 }),
    [],
    'an idle worker claims no readiness'
  );

  controller.abort();
  await running;
  assert.equal(settled, true);
});
