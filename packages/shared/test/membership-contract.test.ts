import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { MembershipMember, memberPresenceStatus, presenceOfMember } from '../src/contracts/membership.ts';
import { buildMembershipEnvelope } from '../src/membership.ts';

test('the member list says afk where every other payload says away, and back', () => {
  assert.equal(memberPresenceStatus('away'), 'afk');
  assert.equal(presenceOfMember('afk'), 'away');
  for (const status of ['online', 'dnd', 'offline'] as const) {
    assert.equal(memberPresenceStatus(status), status);
    assert.equal(presenceOfMember(status), status);
  }
});

test('a built member page matches the contract the web checks it against', () => {
  const page = buildMembershipEnvelope({
    roomId: 'room-a',
    members: [{ userId: 'u-1', displayName: 'Аня', login: 'anya', role: 'owner', presenceStatus: 'afk', inVoice: true }]
  });
  for (const member of page.members) assert.ok(Value.Check(MembershipMember, member));
  assert.equal(page.members[0]?.presenceStatus, 'afk');
});
