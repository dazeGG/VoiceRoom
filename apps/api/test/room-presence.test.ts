// Branch-by-branch proofs for the in-memory voice roster (realtime/room-presence.ts):
// attaching stored rooms, delivering events, closing seats only from their
// own transport, the serialized occupancy writes with retry, the roster wait,
// the idle-room sweep and the record of each finished stay in voice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServerEnvelope, parseServerFrame } from '@voice-room/shared/realtime';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import {
  createRoomPresence,
  type OccupancyStore,
  type RoomPresenceDeps,
  type RosterPeer
} from '../src/realtime/room-presence.ts';
import type { FinishedVoiceSession } from '../src/domains/rooms/voice-session.repository.ts';
import { fake, recordingLogger } from './fakes/index.ts';

const sockets = createConnectionRegistry({
  maxConnectionsPerUser: 10,
  keepaliveMs: 15000,
  getFriendIds: async () => []
});

/** A roster seat with just an id (and a transport when a test sends to it). */
function seat(id: string, transportOf?: RosterPeer['transport']): RosterPeer {
  return fake<RosterPeer>({ id, ...(transportOf === undefined ? {} : { transport: transportOf }) });
}

/** A socket that keeps the type of every frame it gets; a failing one is already closed. */
function socket({ fails = false } = {}) {
  const sent: string[] = [];
  const connection = sockets.addGuestConnection({
    readyState: fails ? 3 : 1,
    send(data: string) {
      const parsed = parseServerFrame(JSON.parse(data));
      sent.push(parsed.ok ? parsed.frame.type : 'invalid');
    },
    close() {}
  });
  return { connection, sent };
}

/** A seat's transport over its own socket. */
function transport(id: string, { fails = false } = {}) {
  return { id, ...socket({ fails }) };
}

/** A socket that previews the room without being in its call. */
function previewer(roomId: string) {
  const watcher = socket();
  watcher.connection.previewRoomIds.add(roomId);
  sockets.registerConnectionForRoom(watcher.connection, roomId);
  return watcher;
}

type HarnessOptions = {
  store?: Partial<OccupancyStore>;
  runtime?: boolean;
  retry?: { baseMs: number; maxMs: number };
  roster?: { waitMs: number; pollMs: number };
  sessions?: RoomPresenceDeps['sessions'];
  now?: () => number;
};

function harness({
  store = {},
  runtime = true,
  retry = { baseMs: 1, maxMs: 4 },
  roster = { waitMs: 30, pollMs: 5 },
  sessions,
  now
}: HarnessOptions = {}) {
  const logger = recordingLogger();
  const calls = {
    active: new Array<unknown>(),
    empty: new Array<unknown>(),
    summaries: new Array<unknown>(),
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
    sockets,
    runtime: () => (runtime ? { scheduleSummaryBroadcast: (roomId) => calls.summaries.push(roomId) } : null),
    logger: () => logger,
    occupancyRetry: retry,
    roster,
    sessions,
    now
  });
  return { calls, presence };
}

/** A voice session sink that keeps what it was given. */
function sessionSink({ fails = false } = {}) {
  const recorded: FinishedVoiceSession[][] = [];
  return {
    recorded,
    sessions: () => ({
      async recordSessions(batch: FinishedVoiceSession[]) {
        if (fails) throw new Error('db down');
        recorded.push(batch);
      }
    })
  };
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
  // A seat's socket that also previews the room hears each event once, over its seat.
  okTransport.connection.activeVoice = { roomId: 'r1', peerId: 'a', sessionToken: '', transportId: 'ta' };
  okTransport.connection.previewRoomIds.add('r1');
  sockets.registerConnectionForRoom(okTransport.connection, 'r1');
  const watcher = previewer('r1');
  presence.publish('r1', buildServerEnvelope('room.deleted', { roomId: 'r1' }), 'c');
  assert.deepEqual(okTransport.sent, ['room.deleted', 'room.peer.left']);
  assert.deepEqual(senderTransport.sent, ['room.peer.left']);
  // The lost peer's leave goes out before the preview watchers get the event itself.
  assert.deepEqual(watcher.sent, ['room.peer.left', 'room.deleted']);
  assert.equal(dead.closed, true);
  assert.equal(room.peers.has('b'), false);
  assert.ok(calls.summaries.includes('r1'));
  const pong = buildServerEnvelope('pong', { at: 1 });
  assert.equal(presence.sendToPeer(null, pong), false);
  assert.equal(presence.sendToPeer({ id: 'x' }, pong), false);
  // A seat whose socket closed is kept for its reconnect lease.
  const held = seat('y', { id: 'ty', connection: null });
  assert.equal(presence.sendToPeer(held, pong), true);
  assert.equal(held.closed, undefined);
});

test('a seat closes only from its own transport; the last one out marks the room empty', async () => {
  const { calls, presence } = harness();
  const room = presence.room('r1');
  const viewer = { id: 'v', viewedScreenPeerId: 'owner', transport: transport('tv') };
  const owner = { id: 'owner', transport: transport('to') };
  room.peers.set('v', viewer);
  room.peers.set('owner', owner);
  const watcher = previewer('r1');
  presence.closePeer('missing-room', 'owner', 'to');
  presence.closePeer('r1', 'nobody', 'to');
  presence.closePeer('r1', 'owner', 'stale-transport');
  presence.closePeer('r1', 'owner', undefined);
  assert.equal(room.peers.size, 2);

  presence.closePeer('r1', 'owner', 'to', 'kicked');
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.deepEqual(viewer.transport.sent, ['room.peer.updated', 'room.peer.left']);
  assert.deepEqual(watcher.sent, ['room.peer.updated', 'room.peer.left']);

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

test('a seat that leaves is recorded as one finished stay; an account keeps its id and a guest has none', async () => {
  const sink = sessionSink();
  const { presence } = harness({ sessions: sink.sessions, now: () => 5000 });
  const room = presence.room('r1');
  room.peers.set('ada', { id: 'ada', accountUserId: 'user-ada', joinedAt: 1000, transport: transport('ta') });
  room.peers.set('guest', {
    id: 'guest',
    accountUserId: '',
    name: 'Петя',
    guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    client: 'browser',
    os: 'Windows',
    browser: 'Chrome',
    ip: '203.0.113.7',
    joinedAt: 2000,
    transport: transport('tg')
  });
  room.peers.set('unjoined', { id: 'unjoined', transport: transport('tu') });

  presence.closePeer('r1', 'ada', 'stale-transport');
  assert.deepEqual(sink.recorded, [], 'a stale transport ends nothing');

  presence.closePeer('r1', 'ada', 'ta');
  presence.closePeer('r1', 'guest', 'tg', 'kicked');
  presence.closePeer('r1', 'unjoined', 'tu');
  await presence.recordOpenSessions();
  // A guest's stay carries its name, browser id, device and address (for the
  // repository to key; the address is never stored).
  const none = { guestName: null, guestId: null, client: null, os: '', browser: '', ip: '' };
  assert.deepEqual(sink.recorded, [
    [{ roomId: 'r1', userId: 'user-ada', ...none, joinedAt: 1000, leftAt: 5000 }],
    [
      {
        roomId: 'r1',
        userId: null,
        guestName: 'Петя',
        guestId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        client: 'browser',
        os: 'Windows',
        browser: 'Chrome',
        ip: '203.0.113.7',
        joinedAt: 2000,
        leftAt: 5000
      }
    ]
  ]);
});

test('stopping records every stay still in voice once; a leave after that is not recorded again', async () => {
  const sink = sessionSink();
  const { presence } = harness({ sessions: sink.sessions, now: () => 9000 });
  presence.room('r1').peers.set('a', { id: 'a', accountUserId: 'user-a', joinedAt: 1000, transport: transport('ta') });
  presence.room('r2').peers.set('b', { id: 'b', joinedAt: 3000, transport: transport('tb') });

  await presence.recordOpenSessions();
  await presence.recordOpenSessions();
  presence.closePeer('r1', 'a', 'ta');
  await presence.recordOpenSessions();
  const none = { guestName: null, guestId: null, client: null, os: '', browser: '', ip: '' };
  assert.deepEqual(sink.recorded, [
    [
      { roomId: 'r1', userId: 'user-a', ...none, joinedAt: 1000, leftAt: 9000 },
      { roomId: 'r2', userId: null, ...none, joinedAt: 3000, leftAt: 9000 }
    ]
  ]);

  presence.reset();
  presence.room('r3').peers.set('c', { id: 'c', joinedAt: 4000, transport: transport('tc') });
  presence.closePeer('r3', 'c', 'tc');
  await presence.recordOpenSessions();
  assert.equal(sink.recorded.length, 2, 'a reset app records again');
});

test('a failed stay write is logged, and without a database nothing is written', async () => {
  const failing = harness({ sessions: sessionSink({ fails: true }).sessions });
  failing.presence.room('r1').peers.set('p', { id: 'p', joinedAt: 1000, transport: transport('tp') });
  failing.presence.closePeer('r1', 'p', 'tp');
  await failing.presence.recordOpenSessions();
  assert.ok(failing.calls.errors.includes('room.voice_session_record_failed'));

  const offline = harness({ sessions: () => null });
  offline.presence.room('r1').peers.set('p', { id: 'p', joinedAt: 1000, transport: transport('tp') });
  offline.presence.closePeer('r1', 'p', 'tp');
  await offline.presence.recordOpenSessions();
  assert.deepEqual(offline.calls.errors, []);
});
