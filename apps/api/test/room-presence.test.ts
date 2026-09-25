// Branch-by-branch proofs for the in-memory voice roster (realtime/room-presence.ts):
// attaching stored rooms, delivering events, closing seats only from their
// own transport, the serialized occupancy writes with retry, the roster wait
// and the idle-room sweep.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoomPresence, type OccupancyStore, type RosterPeer } from '../src/realtime/room-presence.ts';
import { fake, recordingLogger } from './fakes/index.ts';

/** A roster seat with just an id (and a transport when a test sends to it). */
function seat(id: string, transportOf?: RosterPeer['transport']): RosterPeer {
  return fake<RosterPeer>({ id, transport: transportOf });
}

function transport(id: string, { fails = false } = {}) {
  const sent: unknown[] = [];
  return {
    id,
    sent,
    send(message: unknown) {
      if (fails) return false;
      sent.push((message as { type?: string }).type);
      return true;
    }
  };
}

type HarnessOptions = {
  store?: Partial<OccupancyStore>;
  runtime?: boolean;
  retry?: { baseMs: number; maxMs: number };
  roster?: { waitMs: number; pollMs: number };
};

function harness({
  store = {},
  runtime = true,
  retry = { baseMs: 1, maxMs: 4 },
  roster = { waitMs: 30, pollMs: 5 }
}: HarnessOptions = {}) {
  const logger = recordingLogger();
  const calls = {
    active: [] as unknown[],
    empty: [] as unknown[],
    summaries: [] as unknown[],
    mirrored: [] as unknown[],
    get errors() {
      return logger.records.filter((record) => record.level === 'error').map((record) => record.evt);
    }
  };
  const presence = createRoomPresence({
    store: () => ({
      async markRoomActive(roomId: string) {
        calls.active.push(roomId);
      },
      async markRoomEmpty(roomId: string) {
        calls.empty.push(roomId);
      },
      async pruneRooms() {},
      async getRoom(roomId: string) {
        return roomId === 'kept' ? { id: roomId } : null;
      },
      ...store
    }),
    runtime: () =>
      runtime
        ? {
            scheduleSummaryBroadcast: (roomId) => calls.summaries.push(roomId),
            mirrorLegacyRoomEvent: (_roomId, message) => calls.mirrored.push((message as { type?: string }).type)
          }
        : null,
    logger: () => logger,
    occupancyRetry: retry,
    roster
  });
  return { calls, presence };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('stored rooms share the live roster', () => {
  const { presence } = harness();
  assert.equal(presence.attach(null), null);
  const first = presence.attach({ id: 'r1', peers: new Map([['p1', { id: 'p1' }]]) });
  assert.equal(first?.peers, presence.room('r1').peers);
  assert.ok(first?.peers.has('p1'));
  const second = presence.attach({
    id: 'r1',
    peers: new Map([
      ['p1', { id: 'other' }],
      ['p2', { id: 'p2' }]
    ])
  });
  assert.equal(second?.peers.get('p1')?.id, 'p1');
  assert.ok(second?.peers.has('p2'));
  assert.equal(presence.attach({ id: 'r1', peers: presence.room('r1').peers })?.peers.size, 2);
  assert.equal(presence.attach({ id: 'r2' })?.peers.size, 0);
  assert.equal(presence.peerCount(), 2);
});

test('broadcast skips the sender, closes peers whose transport failed and refreshes the summary', () => {
  const { calls, presence } = harness();
  const room = presence.room('r1');
  const okTransport = transport('ta');
  const senderTransport = transport('tc');
  const ok = seat('a', okTransport);
  const dead = seat('b', transport('tb', { fails: true }));
  const sender = seat('c', senderTransport);
  for (const peer of [ok, dead, sender]) room.peers.set(peer.id, peer);
  presence.broadcast(room, { type: 'hello' }, 'c');
  assert.deepEqual(okTransport.sent, ['hello', 'peer-left']);
  assert.deepEqual(senderTransport.sent, ['peer-left']);
  assert.equal(dead.closed, true);
  assert.equal(room.peers.has('b'), false);
  assert.ok(calls.summaries.includes('r1'));
  assert.equal(presence.sendEvent(null, {}), false);
  assert.equal(presence.sendEvent({ id: 'x' }, {}), false);
});

test('a seat closes only from its own transport; the last one out marks the room empty', async () => {
  const { calls, presence } = harness();
  const room = presence.room('r1');
  const viewer = { id: 'v', viewedScreenPeerId: 'owner', transport: transport('tv') };
  const owner = { id: 'owner', transport: transport('to') };
  room.peers.set('v', viewer);
  room.peers.set('owner', owner);
  presence.closePeer('missing-room', 'owner', 'to');
  presence.closePeer('r1', 'nobody', 'to');
  presence.closePeer('r1', 'owner', 'stale-transport');
  presence.closePeer('r1', 'owner', undefined);
  assert.equal(room.peers.size, 2);

  presence.closePeer('r1', 'owner', 'to', 'kicked');
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.deepEqual(viewer.transport.sent, ['peer-updated', 'peer-left']);
  assert.deepEqual(calls.mirrored, ['peer-updated', 'peer-left']);

  const replaced = { id: 'v', replaced: true, transport: transport('tv') };
  room.peers.set('v', replaced);
  room.voiceActiveSince = 5;
  presence.closePeer('r1', 'v', 'tv');
  assert.equal(room.voiceActiveSince, null);
  assert.deepEqual(replaced.transport.sent, []);
  await settle();
  assert.deepEqual(calls.empty, ['r1']);

  const quiet = harness({ runtime: false });
  const quietRoom = quiet.presence.room('r2');
  quietRoom.peers.set('a', { id: 'a', transport: transport('ta') });
  quietRoom.peers.set('b', { id: 'b', transport: transport('tb') });
  quiet.presence.closePeer('r2', 'a', 'ta');
  assert.equal(quietRoom.peers.size, 1);
});

test('occupancy writes are serialized and a failure retries with backoff', async () => {
  let failures = 1;
  const { calls, presence } = harness({
    store: {
      async markRoomActive(roomId: string) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('db down');
        }
        calls.active.push(roomId);
      }
    }
  });
  presence.room('r1').peers.set('p', { id: 'p' });
  await assert.rejects(presence.queueOccupancy('r1'), /db down/);
  await settle();
  assert.deepEqual(calls.active, ['r1']);

  // Two queued transitions run in order; only the newest one clears the queue.
  const first = presence.queueOccupancy('r1');
  const second = presence.queueOccupancy('r1');
  await Promise.all([first, second]);
  assert.deepEqual(calls.active, ['r1', 'r1', 'r1']);
});

test('a retry that fails again is logged and the next one is not stacked', async () => {
  const { calls, presence } = harness({
    store: {
      async markRoomEmpty() {
        throw new Error('db down');
      }
    },
    retry: { baseMs: 1, maxMs: 2 }
  });
  const failing = presence.queueOccupancy('r1');
  await assert.rejects(failing, /db down/);
  await assert.rejects(presence.queueOccupancy('r1'), /db down/);
  await settle();
  assert.ok(calls.errors.includes('room.occupancy_retry_failed'));
  presence.reset();
  assert.equal(presence.rooms.size, 0);
});

test('closing the last seat logs a failed occupancy write', async () => {
  const { calls, presence } = harness({
    store: {
      async markRoomEmpty() {
        throw new Error('db down');
      }
    },
    retry: { baseMs: 1000, maxMs: 1000 }
  });
  presence.room('r1').peers.set('p', { id: 'p', transport: transport('tp') });
  presence.closePeer('r1', 'p', 'tp');
  await settle();
  assert.deepEqual(calls.errors, ['room.occupancy_persist_failed']);
  presence.reset();
});

test('the roster wait returns the peer as soon as it joins, or null at the deadline', async () => {
  const { presence } = harness();
  setTimeout(() => presence.room('r1').peers.set('p', { id: 'p' }), 8);
  assert.equal((await presence.waitForRosterPeer('r1', 'p'))?.id, 'p');
  assert.equal(await presence.waitForRosterPeer('r1', 'missing', 10), null);
});

test('the idle sweep reconciles live rooms first and forgets rooms the store dropped', async () => {
  const order: unknown[] = [];
  const { presence } = harness({
    store: {
      async markRoomActive(roomId: string) {
        order.push(`active:${roomId}`);
      },
      async pruneRooms() {
        order.push('prune');
      }
    }
  });
  presence.room('kept').peers.set('p', { id: 'p' });
  presence.room('gone');
  await presence.prune(1000);
  assert.deepEqual(order, ['active:kept', 'prune']);
  assert.deepEqual([...presence.rooms.keys()], ['kept']);
});
