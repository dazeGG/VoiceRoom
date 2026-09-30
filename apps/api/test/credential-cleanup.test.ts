import assert from 'node:assert/strict';
import test from 'node:test';
import { revokeIssuedAdmission } from '../src/domains/admission/admission.service.ts';
import { fake, recordingLogger } from './fakes/index.ts';

type Boundary = Parameters<typeof revokeIssuedAdmission>[0]['boundary'];
const PRINCIPAL = { principalType: 'account' as const, principalId: 'u' };

test('issued admission cleanup failure is logged, metered and preserves the primary failure', async () => {
  const primary = new Error('membership commit failed');
  const cleanup = new Error('revoke unavailable');
  const logger = recordingLogger();
  let failures = 0;
  await assert.rejects(
    revokeIssuedAdmission({
      boundary: fake<NonNullable<Boundary>>({
        async revokeCredential() {
          throw cleanup;
        }
      }),
      cause: primary,
      credentialId: 'credential',
      principal: PRINCIPAL,
      recordFailure() {
        failures += 1;
      },
      log: logger,
      roomId: 'room'
    }),
    (error) => error instanceof AggregateError && error.errors.includes(primary) && error.errors.includes(cleanup)
  );
  assert.equal(failures, 1);
  assert.equal(logger.records.length, 1);
  assert.equal(logger.records[0]?.code, 'credential_revoke_cleanup_failed');
});

test('successful issued admission cleanup remains silent', async () => {
  let failures = 0;
  let revoked = 0;
  await revokeIssuedAdmission({
    boundary: fake<NonNullable<Boundary>>({
      async revokeCredential(input) {
        revoked += 1;
        assert.equal(input.credentialId, 'credential');
        return { status: 'revoked' };
      }
    }),
    credentialId: 'credential',
    principal: PRINCIPAL,
    recordFailure() {
      failures += 1;
    },
    log: undefined,
    roomId: 'room'
  });
  assert.equal(revoked, 1);
  assert.equal(failures, 0);
});

test('issued admission cleanup fails closed when the exact credential is not revoked', async () => {
  let failures = 0;
  await assert.rejects(
    revokeIssuedAdmission({
      boundary: fake<NonNullable<Boundary>>({
        async revokeCredential() {
          return { status: 'not_found' };
        }
      }),
      credentialId: 'credential',
      principal: PRINCIPAL,
      recordFailure() {
        failures += 1;
      },
      log: undefined,
      roomId: 'room'
    }),
    /cleanup was refused/
  );
  assert.equal(failures, 1);
});
