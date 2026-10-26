// The LiveKit gate's credentials in PostgreSQL: a revoke without what it needs
// to find its target changes nothing and says so, a peer's own credentials go
// without touching the principal's other devices, and a credential issued
// without an expiry has none to wait for.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createGateCredentialRepository } from '../src/domains/admission/gate-credential.repository.ts';
import type { GatePrincipal } from '../src/domains/admission/gate-principal.ts';
import { kyselyOn } from '../src/platform/db/kysely.ts';
import { createTestDatabase } from './db-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ROOM = 'gate-room';
const principal: GatePrincipal = { principalType: 'account', principalId: 'ada' };

async function seeded(t: TestContext) {
  const { cleanup, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ($1, '')`, [ROOM]);
  return createGateCredentialRepository({ db: kyselyOn(pool) });
}

test('a revoke missing its target changes nothing and answers invalid', { skip }, async (t) => {
  const gate = await seeded(t);
  assert.deepEqual(await gate.revokeLiveKitGateCredential({ roomId: ROOM, principal }), { status: 'invalid' });
  assert.deepEqual(await gate.revokeLiveKitGateCredential({ credentialId: 'c1', principal }), { status: 'invalid' });
  assert.deepEqual(await gate.revokeLiveKitGateCredentialsForPeer({ roomId: ROOM, principal }), {
    status: 'invalid',
    revoked: 0
  });
  assert.deepEqual(await gate.revokeLiveKitGateCredentialsForPeer({ peerId: 'p1', roomId: ROOM, principal: null }), {
    status: 'invalid',
    revoked: 0
  });
});

test("a peer's credentials are revoked alone, and one issued without an expiry is never valid", { skip }, async (t) => {
  const gate = await seeded(t);
  const issue = (peerId: string, credentialHash: string, expiresAt?: number) =>
    gate.createLiveKitGateCredential({
      credentialHash,
      peerId,
      principal,
      principalEpoch: null,
      roomId: ROOM,
      ...(expiresAt === undefined ? {} : { expiresAt })
    });
  const verify = (peerId: string, credentialHash: string) =>
    gate.verifyLiveKitGateCredential({
      credentialHash,
      peerId,
      principalEpoch: 0,
      principalId: principal.principalId,
      principalType: principal.principalType,
      roomId: ROOM
    });

  const laptop = await issue('laptop', 'hash-laptop', Date.now() + 60_000);
  assert.equal(laptop.status, 'created');
  assert.equal((await issue('phone', 'hash-phone', Date.now() + 60_000)).status, 'created');
  // No expiry given: it expires as it is written.
  assert.equal((await issue('tablet', 'hash-tablet')).status, 'created');
  assert.deepEqual(await verify('tablet', 'hash-tablet'), { status: 'denied' });

  assert.deepEqual(await gate.revokeLiveKitGateCredentialsForPeer({ peerId: 'laptop', roomId: ROOM, principal }), {
    status: 'revoked',
    revoked: 1
  });
  assert.deepEqual(await verify('laptop', 'hash-laptop'), { status: 'denied' });
  // The account's other device keeps its credential: the epoch did not move.
  assert.deepEqual(await verify('phone', 'hash-phone'), { status: 'allowed' });
});
