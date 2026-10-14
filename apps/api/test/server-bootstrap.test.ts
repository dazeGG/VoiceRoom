import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrap, createApiServer } from '../src/server.ts';
import { recordingLogger } from './fakes/index.ts';

test('importing server exposes an app factory without binding or requiring DATABASE_URL', () => {
  assert.equal(typeof createApiServer, 'function');
  const server = createApiServer();
  assert.equal(server.listening, false);
  server.close();
});

test('bootstrap fails before listen when DATABASE_URL is missing', async () => {
  let exitCode: number | undefined;
  const logger = recordingLogger();
  const logs = logger.records;
  const result = await bootstrap({
    env: {},
    logger,
    exit: (code) => {
      exitCode = code;
    }
  });

  assert.equal(result, null);
  assert.equal(exitCode, 1);
  const fatal = logs.filter((record) => record.level === 'fatal');
  assert.equal(fatal.length, 1);
  assert.equal(fatal[0]?.evt, 'boot.failed');
  assert.match((fatal[0]?.err as Error | undefined)?.message ?? '', /DATABASE_URL is required/);
});

test(
  'SIGTERM shuts a running API down cleanly instead of waiting for the shutdown timeout',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { createTestDatabase } = await import('./db-harness.ts');
    const db = await createTestDatabase(t);
    t.after(db.cleanup);
    const uploads = await import('node:fs').then(({ mkdtempSync }) =>
      mkdtempSync((process.env.TMPDIR || process.env.TEMP || '/tmp') + '/vr-uploads-')
    );
    const logger = recordingLogger();
    const exits: Array<number | undefined> = [];
    const server = await bootstrap({
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: db.databaseUrl,
        HOST: '127.0.0.1',
        PORT: '0',
        UPLOADS_DIR: uploads,
        MIGRATE_ON_START: 'false'
      },
      logger,
      exit: (code) => exits.push(code)
    });
    assert.ok(server);
    // The message delivery listener holds a pool client from the moment the app is ready.
    while (!server.listening) await new Promise((resolve) => setTimeout(resolve, 10));

    const started = Date.now();
    process.emit('SIGTERM');
    while (exits.length === 0 && Date.now() - started < 9_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.deepEqual(exits, [0], 'the API exits with 0, not through the timeout');
    assert.ok(Date.now() - started < 3_000, `shutdown took ${Date.now() - started} ms`);
    const events = logger.records.map((record) => record.evt);
    assert.ok(events.includes('boot.shutdown_completed'));
    assert.ok(!events.includes('boot.shutdown_timeout'));
  }
);
