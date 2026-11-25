import assert from 'node:assert/strict';
import test from 'node:test';
import { createReconnectLeases } from '../../../src/realtime/reconnect-leases.ts';
import type { Peer, PresenceRoom } from '../../../src/realtime/runtime-types.ts';
import { fake } from '../../fakes/index.ts';

test('account cancellation never schedules expiry for another account replacing the same peer id', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const peers = new Map<string, Peer>();
  const room = fake<PresenceRoom>({ peers });
  const ended: string[] = [];
  const leases = createReconnectLeases({
    presenceRooms: new Map([['room', room]]),
    tokensMatch: (a, b) => Boolean(a) && a === b,
    now: Date.now,
    setTimeout,
    clearTimeout,
    leaseMs: 1000,
    joinSequence: () => 1,
    finalizeOwnedPeer: async ({ peer }) => {
      ended.push(peer.accountUserId || 'guest');
      if (peers.get(peer.id) === peer) peers.delete(peer.id);
    }
  });
  const makePeer = (userId: string) =>
    fake<Peer>({
      id: 'same-peer',
      accountUserId: userId,
      sessionToken: userId,
      transport: { id: userId, connection: null }
    });
  peers.set('same-peer', makePeer('A'));
  await leases.cancelAccount({ roomId: 'room', userId: 'A', reason: 'room.banned' });
  assert.deepEqual(ended, ['A']);
  const replacement = makePeer('B');
  peers.set('same-peer', replacement);
  await leases.cancelAccount({ roomId: 'room', userId: 'A', reason: 'room.banned' });
  t.mock.timers.tick(2000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(peers.get('same-peer'), replacement);
  assert.deepEqual(ended, ['A']);
});
