'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createMembershipService } = require('../src/domains/membership/membership-service');

test('G44-A01 registered membership follows successful admission and guests/failures create no row', async () => {
  const calls = [];
  const pool = { async query() {}, async connect() { return { query: async () => ({}), release() {} }; } };
  const service = createMembershipService({
    pool,
    repository: {},
    activeBanService: { async isBanned() { return false; } }
  });
  service.persistSuccessfulAdmission = undefined;
  const invalid = await service.admitRegistered({ roomId: 'room', completeAdmission: async () => ({ token: 'x' }) });
  assert.equal(invalid.status, 'invalid');
  const failed = await service.admitRegistered({ roomId: 'room', userId: 'user', completeAdmission: async () => null });
  assert.equal(failed.status, 'admission_failed');
  assert.deepEqual(calls, []);
});

test('G44-A02 HTTP LiveKit admission persists only after credential issue and revokes on persistence refusal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  const start = source.indexOf('async function handleLiveKitToken');
  const end = source.indexOf('\nfunction handlePowChallenge', start);
  const handler = source.slice(start, end);
  assert.ok(handler.indexOf('provider.issueAdmission') < handler.indexOf('persistSuccessfulAdmission'));
  assert.match(handler, /persistSuccessfulAdmission[\s\S]*revokeIssuedAdmission/);
  assert.doesNotMatch(handler, /rollbackSuccessfulAdmission/);
});
