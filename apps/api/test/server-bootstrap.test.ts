// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrap, createApiServer } from '../src/server.ts';

test('importing server exposes an app factory without binding or requiring DATABASE_URL', () => {
  assert.equal(typeof createApiServer, 'function');
  const server = createApiServer();
  assert.equal(server.listening, false);
  server.close();
});

test('bootstrap fails before listen when DATABASE_URL is missing', async () => {
  let exitCode = null;
  const logs = [];
  const result = await bootstrap({
    env: {},
    logger: {
      info() {},
      warn() {},
      error() {},
      fatal: (fields, msg) => logs.push({ ...fields, msg })
    },
    exit: (code) => {
      exitCode = code;
    }
  });

  assert.equal(result, null);
  assert.equal(exitCode, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].evt, 'boot.failed');
  assert.match(logs[0].err.message, /DATABASE_URL is required/);
});
