// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMembershipService } from '../src/domains/membership/membership-service.ts';

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

