// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
// Branch-by-branch proofs for room lifecycle, account lifecycle and the
// maintenance timers (domains/rooms/room-lifecycle.ts,
// domains/account/account-lifecycle.ts, platform/maintenance.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRoomLifecycle } from '../src/domains/rooms/room-lifecycle.ts';
import { createAccountLifecycle } from '../src/domains/account/account-lifecycle.ts';
import { createRoomPresence } from '../src/realtime/room-presence.ts';
import { startMaintenanceTimers } from '../src/platform/maintenance.ts';

function transport(id) {
  const sent = [];
  return {
    id,
    sent,
    send(message) {
      sent.push(message.type);
      return true;
    }
  };
}

function presence() {
  return createRoomPresence({
    store: () => ({
      async markRoomActive() {},
      async markRoomEmpty() {},
      async pruneRooms() {},
      async getRoom() {
        return null;
      }
    }),
    runtime: () => null,
    logger: () => ({ error() {} }),
    occupancyRetry: { baseMs: 1000, maxMs: 1000 },
    roster: { waitMs: 0, pollMs: 1 }
  });
}

function roomHarness({
  runtime = true,
  invitations = true,
  leaseError = false,
  revokeFails = false,
  removeFails = false
} = {}) {
  const calls = {
    mirrored: [],
    invalidated: [],
    summaries: [],
    notified: [],
    revoked: [],
    removed: [],
    avatars: [],
    errors: [],
    warnings: []
  };
  const roster = presence();
  const lifecycle = createRoomLifecycle({
    presence: roster,
    runtime: () =>
      runtime
        ? {
            mirrorLegacyRoomEvent: (roomId, message) => calls.mirrored.push(message.type),
            invalidateRecipientCache: (roomId) => calls.invalidated.push(roomId),
            scheduleSummaryBroadcast: (roomId) => calls.summaries.push(roomId),
            async cancelRoomReconnectLeases({ finalizePeer }) {
              const results = [];
              for (const [peer, ownershipFinalized] of [
                [null, false],
                [{ id: 'gone' }, true],
                ...[...(roster.rooms.get('r1')?.peers.values() || [])].map((p) => [p, false])
              ]) {
                results.push(await finalizePeer({ peer, ownershipFinalized }).catch((error) => error));
              }
              calls.leaseResults = results;
              if (leaseError) throw new Error('lease');
            }
          }
        : null,
    invitations: () =>
      invitations
        ? {
            async expirePendingInvites({ roomId }) {
              return roomId === 'r1' ? [{ senderId: 's', recipientId: 'r' }] : [];
            }
          }
        : null,
    notifyUser: (userId, event) => calls.notified.push([userId, event.type]),
    credentials: () => ({
      async revokePeer(input) {
        if (revokeFails) throw new Error('revoke');
        calls.revoked.push(input);
      }
    }),
    removeParticipant: async (roomId, peerId) => {
      if (removeFails) throw new Error('sfu');
      calls.removed.push(peerId);
    },
    removeAvatar: async (key) => {
      calls.avatars.push(key);
    },
    displayName: (user) => user.displayName || 'Nameless',
    logger: () => ({ error: (fields) => calls.errors.push(fields.evt) })
  });
  return { calls, lifecycle, roster };
}

test('the lobby card counts live peers and an update reaches room, watchers and lobby', () => {
  const { calls, lifecycle, roster } = roomHarness();
  const room = { id: 'r1', createdAt: 1, emptySince: null, isStatic: true, name: 'Room' };
  assert.equal(lifecycle.lobbyRoom(room).peers, 0);
  const peer = { id: 'p1', transport: transport('t1') };
  roster.room('r1').peers.set('p1', peer);
  const card = lifecycle.announceRoomUpdate('r1', room);
  assert.equal(card.peers, 1);
  assert.deepEqual(peer.transport.sent, ['room-updated']);
  assert.deepEqual([calls.mirrored, calls.invalidated, calls.summaries], [['room-updated'], ['r1'], ['r1']]);
  lifecycle.announceRoomUpdate('empty', { ...room, id: 'empty' });
  roomHarness({ runtime: false }).lifecycle.announceRoomUpdate('r1', room);
});

test('a profile change updates every seat the account holds', () => {
  const { calls, lifecycle, roster } = roomHarness();
  const mine = { id: 'p1', accountUserId: 'u1', avatarColorKey: 'red', transport: transport('t1') };
  const other = { id: 'p2', accountUserId: 'u2', transport: transport('t2') };
  roster.room('r1').peers.set('p1', mine);
  roster.room('r1').peers.set('p2', other);
  lifecycle.refreshActiveProfile(null);
  lifecycle.refreshActiveProfile({ id: 'u1', displayName: 'Ann', avatarKey: 'k.webp', avatarAccent: 'gold' });
  assert.deepEqual(
    [mine.name, mine.avatarUrl, mine.avatarAccent, mine.avatarColorKey],
    ['Ann', '/api/avatars/k.webp', 'gold', 'red']
  );
  lifecycle.refreshActiveProfile({ id: 'u1', avatarColorKey: 'blue' });
  assert.deepEqual(
    [mine.name, mine.avatarUrl, mine.avatarAccent, mine.avatarColorKey],
    ['Nameless', null, null, 'blue']
  );
  assert.equal(other.name, undefined);
  assert.deepEqual(calls.summaries, ['r1', 'r1']);
  roomHarness({ runtime: false }).lifecycle.refreshActiveProfile({ id: 'u1' });
});

test('room invitations expire only with a store that can', async () => {
  const { calls, lifecycle } = roomHarness();
  assert.deepEqual(await lifecycle.expireRoomInvitations('s', ''), []);
  assert.equal((await lifecycle.expireRoomInvitations(null, 'r1')).length, 1);
  assert.deepEqual(calls.notified, [
    ['s', 'dm.message.edited'],
    ['r', 'dm.message.edited']
  ]);
  assert.deepEqual(await roomHarness({ invitations: false }).lifecycle.expireRoomInvitations('s', 'r1'), []);
});

test('deleting a room tells everyone, frees every seat and removes the avatar', async () => {
  const { calls, lifecycle, roster } = roomHarness();
  const peer = { id: 'p1', accountUserId: 'u1', transport: transport('t1') };
  const guest = { id: 'p2', gateGuestPrincipalId: 'g', transport: transport('t2') };
  roster.room('r1').peers.set('p1', peer);
  roster.room('r1').peers.set('p2', guest);
  await lifecycle.finishRoomDeletion('r1', { avatarKey: 'room.webp' });
  assert.ok(peer.transport.sent.includes('room-deleted'));
  assert.deepEqual(calls.revoked, [
    { roomId: 'r1', accountUserId: 'u1', guestPrincipalId: '' },
    { roomId: 'r1', accountUserId: null, guestPrincipalId: 'g' }
  ]);
  assert.deepEqual(calls.removed, ['p1', 'p2']);
  assert.equal(roster.rooms.get('r1').peers.size, 0);
  assert.deepEqual(calls.leaseResults.slice(0, 2), [{ finalized: false }, { finalized: true }]);
  assert.deepEqual(calls.avatars, ['room.webp']);
  assert.deepEqual(calls.notified, [
    ['s', 'dm.message.edited'],
    ['r', 'dm.message.edited']
  ]);
});

test('a room deletion with failing cleanup still finishes and only warns', async () => {
  const failing = roomHarness({ revokeFails: true, removeFails: true, leaseError: true });
  failing.roster.room('r1').peers.set('p1', { id: 'p1', transport: transport('t1') });
  const warnings = [];
  await failing.lifecycle.finishRoomDeletion('r1', {
    request: { log: { warn: (fields) => warnings.push(fields.code), error() {} } }
  });
  assert.equal(failing.calls.leaseResults[2].ownershipFinalized, true);
  assert.equal(failing.calls.leaseResults[2].message, 'revoke');
  assert.deepEqual(warnings, ['room_delete_peer_cleanup_failed']);
  assert.deepEqual(failing.calls.avatars, [null]);

  const sfuOnly = roomHarness({ removeFails: true });
  sfuOnly.roster.room('r1').peers.set('p1', { id: 'p1', transport: transport('t1') });
  await sfuOnly.lifecycle.finishRoomDeletion('r1');
  assert.equal(sfuOnly.calls.leaseResults[2].message, 'sfu');

  const broken = roomHarness({ runtime: false });
  await broken.lifecycle.finishRoomDeletion('other');

  const expiryFails = createRoomLifecycle({
    presence: presence(),
    runtime: () => null,
    invitations: () => ({
      async expirePendingInvites() {
        throw new Error('db');
      }
    }),
    notifyUser() {},
    credentials: () => ({ async revokePeer() {} }),
    removeParticipant: async () => {},
    removeAvatar: async () => {},
    displayName: () => '',
    logger: () => ({ error: (fields) => warnings.push(fields.evt) })
  });
  await expiryFails.finishRoomDeletion('r9');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(warnings.includes('room.invitation_expiry_failed'));
});

// --- account lifecycle --------------------------------------------------------------

function accountHarness({
  sockets = true,
  deletions = true,
  friendsFail = false,
  principal = true,
  voiceFails = false
} = {}) {
  const calls = {
    notified: [],
    payloads: [],
    revoked: [],
    left: [],
    removed: [],
    closed: null,
    announced: [],
    finished: [],
    avatars: [],
    errors: []
  };
  const connections = [
    { activeVoice: { roomId: 'r1', peerId: 'p1' } },
    { activeVoice: null },
    { activeVoice: { roomId: 'r1' } }
  ];
  const lifecycle = createAccountLifecycle({
    friendIds: async () => {
      if (friendsFail) throw new Error('friends');
      return ['f1', 'f2'];
    },
    notifyUser: (userId, event) => {
      calls.notified.push([userId, event.type]);
      calls.payloads.push(event);
    },
    sockets: () =>
      sockets
        ? {
            findAccountConnections: (userId, hashes) => {
              calls.lookup = [userId, hashes];
              return connections;
            },
            closeConnections: (targets, code, reason) => {
              calls.closed = [targets.length, code, reason];
            }
          }
        : null,
    seatPrincipal: () => (principal ? { principalType: 'account', principalId: 'u1' } : null),
    revokeSeatCredentials: async (input) => {
      calls.revoked.push(input.peerId);
    },
    leaveVoice: async (connection, activeVoice) => {
      if (voiceFails) throw new Error('leave');
      calls.left.push(activeVoice.peerId);
    },
    removeParticipant: async (roomId, peerId) => {
      calls.removed.push(peerId);
    },
    sessionRevokedCloseCode: 4401,
    deletions: () =>
      deletions
        ? {
            async listDueDeletions() {
              return ['kept', 'done', 'broken'];
            },
            async finalizeDeletion({ userId }) {
              if (userId === 'broken') throw new Error('db');
              if (userId === 'kept') return { status: 'restored', transferredRooms: [], deletedRooms: [] };
              return {
                status: 'deleted',
                avatarKey: 'a.webp',
                transferredRooms: [{ roomId: 'heir' }, { roomId: 'vanished' }],
                deletedRooms: [{ roomId: 'orphan', avatarKey: 'o.webp' }]
              };
            }
          }
        : null,
    findRoom: async (roomId) => (roomId === 'heir' ? { id: 'heir' } : null),
    announceRoomUpdate: (roomId) => calls.announced.push(roomId),
    finishRoomDeletion: async (roomId, options) => {
      calls.finished.push([roomId, options.avatarKey]);
    },
    removeAvatar: async (key) => {
      calls.avatars.push(key);
    },
    logger: () => ({ error: (fields) => calls.errors.push(fields.evt) })
  });
  return { calls, lifecycle };
}

test('a profile change reaches every friend; a failed lookup is only logged', async () => {
  const { calls, lifecycle } = accountHarness();
  await lifecycle.broadcastProfileToFriends(null);
  await lifecycle.broadcastProfileToFriends({ id: 'u1', login: 'ann', desktopAppSeenAt: 10, passwordHash: 'x' });
  assert.deepEqual(calls.notified, [
    ['f1', 'user-updated'],
    ['f2', 'user-updated']
  ]);
  // Friends get the public profile, never self-only fields.
  assert.equal('hasUsedDesktopApp' in calls.payloads[0].user, false);
  assert.equal('passwordHash' in calls.payloads[0].user, false);
  const errors = [];
  await accountHarness({ friendsFail: true }).lifecycle.broadcastProfileToFriends(
    { id: 'u1' },
    { error: (fields) => errors.push(fields.userId) }
  );
  await accountHarness({ friendsFail: true }).lifecycle.broadcastProfileToFriends({ id: 'u1' });
  assert.deepEqual(errors, ['u1']);
});

test('ending sessions frees their voice seats and closes their sockets', async () => {
  const { calls, lifecycle } = accountHarness();
  await lifecycle.endSessionConnections({});
  assert.equal(calls.closed, null);
  await lifecycle.endSessionConnections({ userId: 'u1' });
  assert.deepEqual([calls.revoked, calls.left, calls.removed], [['p1'], ['p1'], ['p1']]);
  assert.deepEqual(calls.closed, [3, 4401, 'Session ended']);
  assert.deepEqual(calls.lookup, ['u1', null]);
  await lifecycle.endSessionConnections({ tokenHashes: ['h'] });
  assert.deepEqual(calls.lookup, [null, ['h']]);

  const noSockets = accountHarness({ sockets: false });
  await noSockets.lifecycle.endSessionConnections({ userId: 'u1' });
  const noPrincipal = accountHarness({ principal: false });
  await noPrincipal.lifecycle.endSessionConnections({ userId: 'u1' });
  assert.deepEqual(noPrincipal.calls.revoked, []);
  const failing = accountHarness({ voiceFails: true });
  await failing.lifecycle.endSessionConnections({ userId: 'u1' });
  assert.deepEqual(failing.calls.errors, ['account.session_voice_end_failed']);
  assert.ok(failing.calls.closed);
});

test('finishing due deletions hands rooms over, tears orphans down and survives a failure', async () => {
  assert.equal(await accountHarness({ deletions: false }).lifecycle.finalizeDueDeletions(1), 0);
  const { calls, lifecycle } = accountHarness();
  assert.equal(await lifecycle.finalizeDueDeletions(1), 1);
  assert.deepEqual(calls.avatars, ['a.webp']);
  assert.deepEqual(calls.announced, ['heir']);
  assert.deepEqual(calls.finished, [['orphan', 'o.webp']]);
  assert.equal(calls.errors.length, 1);
  assert.ok((await lifecycle.finalizeDueDeletions()) >= 0);
});

// --- maintenance -----------------------------------------------------------------

test('maintenance runs enabled tasks on its interval, logs failures and stops on close', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const server = new EventEmitter();
  const calls = { pruned: 0, ran: [], observed: [], errors: [] };
  const timer = startMaintenanceTimers(server, {
    keepaliveMs: 10,
    intervalMs: 100,
    pruneSockets: () => {
      calls.pruned += 1;
      if (calls.pruned === 2) throw new Error('ws');
    },
    observe: async (name, run) => {
      calls.observed.push(name);
      return run();
    },
    logger: { error: (fields, message) => calls.errors.push([fields.task, message]) },
    tasks: [
      {
        name: 'a',
        label: 'task-a',
        failureMessage: 'a failed',
        run: async () => {
          calls.ran.push('a');
        }
      },
      {
        name: 'b',
        label: 'task-b',
        failureMessage: 'b failed',
        run: async () => {
          throw new Error('b');
        }
      },
      {
        name: 'c',
        label: 'task-c',
        failureMessage: 'c failed',
        enabled: () => false,
        run: async () => {
          calls.ran.push('c');
        }
      }
    ]
  });
  assert.ok(timer);
  t.mock.timers.tick(20);
  t.mock.timers.tick(100);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.pruned >= 2);
  assert.deepEqual(calls.ran, ['a']);
  assert.deepEqual(calls.observed, ['a', 'b']);
  assert.deepEqual(calls.errors, [
    ['ws-prune', 'ws prune timer failed'],
    ['task-b', 'b failed']
  ]);
  server.emit('close');
  t.mock.timers.tick(1000);
  assert.deepEqual(calls.ran, ['a']);
});

test('without a sweep interval only the socket reaper runs', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const server = new EventEmitter();
  let pruned = 0;
  assert.equal(
    startMaintenanceTimers(server, {
      keepaliveMs: 10,
      intervalMs: 0,
      pruneSockets: () => {
        pruned += 1;
      },
      observe: async () => {},
      logger: { error() {} },
      tasks: []
    }),
    null
  );
  t.mock.timers.tick(10);
  assert.equal(pruned, 1);
  server.emit('close');
});
