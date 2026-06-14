'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { bootstrap, createApiServer } = require('../src/server');

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
      log() {},
      error: (...items) => logs.push(items.join(' '))
    },
    exit: (code) => {
      exitCode = code;
    }
  });

  assert.equal(result, null);
  assert.equal(exitCode, 1);
  assert.match(logs.join('\n'), /DATABASE_URL is required/);
});
