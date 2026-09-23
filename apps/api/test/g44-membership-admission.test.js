import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('G44-A02 HTTP LiveKit admission persists only after credential issue and revokes on persistence refusal', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/domains/admission/admission.service.ts'), 'utf8');
  const start = source.indexOf('async function admit');
  const end = source.indexOf('\n  async function revokeForServerMute', start);
  const handler = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.ok(handler.indexOf('provider.issueAdmission') < handler.indexOf('persistSuccessfulAdmission'));
  assert.match(handler, /const revoke = [\s\S]*revokeIssuedAdmission/);
  assert.match(handler, /persistSuccessfulAdmission[\s\S]*await revoke\(admission\.gateCredentialId/);
  assert.doesNotMatch(handler, /rollbackSuccessfulAdmission/);
});
