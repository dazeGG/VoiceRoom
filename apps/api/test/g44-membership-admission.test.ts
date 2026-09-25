import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MembershipRepository } from '../src/domains/membership/membership-repository.ts';
import { createMembershipService, type BanCheck } from '../src/domains/membership/membership-service.ts';
import { fake, fakeDb } from './fakes/index.ts';

test('G44-A01 registered membership follows successful admission and guests/failures create no row', async () => {
  const pool = fakeDb();
  const service = createMembershipService({
    pool,
    repository: fake<MembershipRepository>(),
    activeBanService: fake<BanCheck>({ isBanned: async () => false })
  });
  const invalid = await service.admitRegistered({ roomId: 'room', completeAdmission: async () => ({ token: 'x' }) });
  assert.equal(invalid.status, 'invalid');
  const failed = await service.admitRegistered({ roomId: 'room', userId: 'user', completeAdmission: async () => null });
  assert.equal(failed.status, 'admission_failed');
  assert.deepEqual(pool.calls, [], 'no membership row is written');
});
