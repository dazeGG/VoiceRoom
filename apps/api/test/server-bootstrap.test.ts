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
