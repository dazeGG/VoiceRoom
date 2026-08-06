'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { __private: { revokeIssuedAdmission } } = require('../src/server');

test('issued admission cleanup failure is logged, metered and preserves the primary failure', async () => {
  const primary = new Error('membership commit failed'); const cleanup = new Error('revoke unavailable');
  const logs = []; let failures = 0;
  await assert.rejects(
    revokeIssuedAdmission({ boundary: { async revokeCredential() { throw cleanup; } }, cause: primary, credentialId: 'credential', principal: { principalId: 'u' }, recordFailure() { failures += 1; }, req: { log: { error(value, message) { logs.push([value, message]); } } }, roomId: 'room' }),
    (error) => error instanceof AggregateError && error.errors.includes(primary) && error.errors.includes(cleanup)
  );
  assert.equal(failures, 1); assert.equal(logs.length, 1); assert.equal(logs[0][0].code, 'credential_revoke_cleanup_failed');
});

test('successful issued admission cleanup remains silent', async () => {
  let failures = 0; let revoked = 0;
  await revokeIssuedAdmission({ boundary: { async revokeCredential(input) { revoked += 1; assert.equal(input.credentialId, 'credential'); return { status: 'revoked' }; } }, credentialId: 'credential', principal: { principalId: 'u' }, recordFailure() { failures += 1; }, roomId: 'room' });
  assert.equal(revoked, 1); assert.equal(failures, 0);
});

test('issued admission cleanup fails closed when the exact credential is not revoked', async () => {
  let failures = 0;
  await assert.rejects(
    revokeIssuedAdmission({ boundary: { async revokeCredential() { return { status: 'not_found' }; } }, credentialId: 'credential', principal: { principalId: 'u' }, recordFailure() { failures += 1; }, roomId: 'room' }),
    /cleanup was refused/
  );
  assert.equal(failures, 1);
});
