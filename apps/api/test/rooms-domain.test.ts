// Branch-by-branch proofs for the rooms group (domains/rooms): creating,
// renaming and deleting rooms, the owner check, the status card and peer
// preview, /api/state, the account room list, and the owner's kick, server
// mute and ban with the peer eviction behind them. Routes run on a bare
// Fastify app with fake dependencies so every HTTP answer is pinned.

import type { PowVerdict } from '../src/lib/pow.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import type { ApiContext } from '../src/app/context.ts';
import { gatePrincipalForPeer, isGatePrincipal } from '../src/domains/admission/gate-principal.ts';
import type { LiveKitConfig } from '../src/domains/admission/livekit-config.ts';
import {
  createPeerEviction,
  type EvictionStore,
  type FinalizeOptions,
  type PeerEviction
} from '../src/domains/rooms/peer-eviction.ts';
import {
  createPeerModerationService,
  type PeerModerationDeps,
  type PeerModerationService,
  type PeerModerationStore
} from '../src/domains/rooms/peer-moderation.service.ts';
import { registerPeerModerationRoutes } from '../src/domains/rooms/peer-moderation.routes.ts';
import {
  publicLobbyRoom,
  publicPeer,
  roomAvatarUrl,
  roomBanned,
  type LiveRoom,
  type PresencePeer,
  type StoredRoom
} from '../src/domains/rooms/room-views.ts';
import { ownerRefusal, registerRoomRoutes } from '../src/domains/rooms/rooms.routes.ts';
import {
  createRoomId,
  createRoomsService,
  type CreateRoomResult,
  type RoomsService,
  type RoomsStore
} from '../src/domains/rooms/rooms.service.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, recordingLogger, storedUser, storedRoom } from './fakes/index.ts';

const OWNER = 'owner-1';

function livekitConfig(overrides: Partial<LiveKitConfig>): LiveKitConfig {
  return {
    adminUrl: '',
    apiKey: '',
    apiSecret: '',
    enabled: false,
    gateSecret: '',
    gateUrl: '',
    url: '',
    ...overrides
  };
}
const STRICT = livekitConfig({ enabled: true, gateSecret: 'x'.repeat(32) });
const LOOSE = livekitConfig({ enabled: false, gateSecret: '' });

function liveRoom(overrides: Partial<LiveRoom> = {}, peers: PresencePeer[] = []): LiveRoom {
  return {
    id: 'room-1',
    createdAt: 1,
    emptySince: null,
    isStatic: true,
    name: 'Room',
    ownerId: OWNER,
    peers: new Map(peers.map((peer) => [peer.id, peer])),
    updatedAt: 1,
    ...overrides
  };
}

// --- views and principals ----------------------------------------------------

test('room views keep the shapes the web client mirrors', () => {
  assert.equal(roomAvatarUrl(null), null);
  assert.equal(roomAvatarUrl('room/a b.webp'), '/api/avatars/room%2Fa%20b.webp');
  const peer = publicPeer({
    id: 'peer0001',
    name: 'A',
    serverMuted: 1 as never,
    sessionToken: 'secret',
    ip: '10.0.0.1'
  });
  assert.equal(peer.accountUserId, '');
  assert.equal(peer.serverMuted, true);
  assert.equal(peer.avatarAccent, null);
  assert.ok(peer.avatarColorKey);
  assert.equal('sessionToken' in peer, false);
  assert.equal('ip' in peer, false);
  assert.equal(publicPeer({ id: 'p', avatarColorKey: 'blue' }).avatarColorKey, 'blue');

  const base = { id: 'room-1', createdAt: 1, emptySince: null, isStatic: true, name: 'Room', avatarKey: 'k' };
  assert.deepEqual(publicLobbyRoom(base, 2), {
    avatarUrl: '/api/avatars/k',
    createdAt: 1,
    emptySince: null,
    isStatic: true,
    name: 'Room',
    peers: 2,
    relationship: 'owner',
    roomId: 'room-1'
  });
  const listed = publicLobbyRoom({ ...base, relationship: 'member', lastMessageAt: null, unreadCount: -3 }, 0);
  assert.equal(listed.relationship, 'member');
  assert.equal(listed.lastMessageAt, null);
  assert.equal(listed.unreadCount, 0);
  assert.equal('unreadCount' in publicLobbyRoom({ ...base, unreadCount: Number.NaN }, 0), false);
  assert.deepEqual(roomBanned('room-1'), {
    ok: false,
    error: 'Вы заблокированы в этой комнате',
    code: 'room_banned',
    roomId: 'room-1'
  });
});

test('gate principals are recognised only with a type and a non-empty id', () => {
  assert.equal(isGatePrincipal({ principalType: 'account', principalId: 'u' }), true);
  assert.equal(isGatePrincipal({ principalType: 'guest', principalId: 'g' }), true);
  assert.equal(isGatePrincipal({ principalType: 'guest', principalId: '  ' }), false);
  assert.equal(isGatePrincipal({ principalType: 'robot', principalId: 'x' }), false);
  assert.equal(isGatePrincipal(null), false);
  const calls: unknown[] = [];
  const store = {
    normalizeGatePrincipal: (input: unknown) => {
      calls.push(input);
      return null;
    }
  };
  assert.equal(gatePrincipalForPeer(store, 'room-1', {}), null);
  gatePrincipalForPeer(store, 'room-1', { accountUserId: 'u', gateGuestPrincipalId: 'g' });
  assert.deepEqual(calls, [
    { accountUserId: null, guestPrincipalId: '', roomId: 'room-1' },
    { accountUserId: 'u', guestPrincipalId: 'g', roomId: 'room-1' }
  ]);
});

// --- rooms service -------------------------------------------------------------

function roomsHarness({
  taken = [],
  created = null,
  room = null,
  updated = null,
  deleted = null,
  withRoomIdExists = true
}: {
  taken?: string[];
  created?: CreateRoomResult | null;
  room?: LiveRoom | null;
  updated?: StoredRoom | null;
  deleted?: { avatarKey?: string | null } | null;
  withRoomIdExists?: boolean;
} = {}) {
  const calls = {
    created: [] as unknown[],
    announced: [] as string[],
    finished: [] as Array<{ roomId: string; avatarKey?: string | null; request?: unknown }>
  };
  const ids = ['taken-1', 'fresh-1'];
  const store: RoomsStore = {
    async getRoom(roomId) {
      return taken.includes(roomId) ? storedRoom({ id: roomId }) : null;
    },
    async createRoomWithQuota(input) {
      calls.created.push(input);
      return created || { status: 'created', room: storedRoom({ id: input.roomId }) };
    },
    async updateRoom() {
      return updated;
    },
    async deleteRoom() {
      return deleted;
    }
  };
  if (withRoomIdExists) store.roomIdExists = async (roomId) => taken.includes(roomId);
  const service = createRoomsService({
    store: () => store,
    getRoom: async () => room,
    limits: { maxRooms: 10, maxOwnedStaticRoomsPerUser: 3, maxTempRoomsPerIp: 2 },
    announceRoomUpdate: (roomId, value) => {
      calls.announced.push(roomId);
      return publicLobbyRoom(value, 0);
    },
    finishRoomDeletion: async (roomId, options) => {
      calls.finished.push({ roomId, ...options });
    },
    newRoomId: () => ids.shift() || 'fallback'
  });
  return { calls, service };
}

test('room ids use the unambiguous alphabet', () => {
  assert.match(createRoomId(), /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/);
});

test('creating a room skips taken ids and passes the quotas to the store', async () => {
  for (const withRoomIdExists of [true, false]) {
    const { calls, service } = roomsHarness({ taken: ['taken-1'], withRoomIdExists });
    const result = await service.createRoom({ creatorIp: '1.2.3.4', isStatic: false, ownerId: null, name: 'n' });
    assert.equal(result.status, 'created');
    assert.deepEqual(calls.created[0], {
      creatorIp: '1.2.3.4',
      isStatic: false,
      ownerId: null,
      name: 'n',
      maxOwnedStaticRoomsPerUser: 3,
      maxRooms: 10,
      maxTempRoomsPerIp: 2,
      roomId: 'fresh-1'
    });
  }
});

test('the owner check refuses guests, missing rooms, temporary rooms and other users', async () => {
  assert.equal((await roomsHarness().service.checkOwner(null, 'room-1')).status, 'unauthenticated');
  assert.equal((await roomsHarness().service.checkOwner(OWNER, 'room-1')).status, 'not_found');
  assert.equal(
    (await roomsHarness({ room: liveRoom({ isStatic: false }) }).service.checkOwner(OWNER, 'room-1')).status,
    'forbidden'
  );
  assert.equal((await roomsHarness({ room: liveRoom() }).service.checkOwner('someone', 'room-1')).status, 'forbidden');
  const owned = await roomsHarness({ room: liveRoom() }).service.checkOwner(OWNER, 'room-1');
  assert.equal(owned.status, 'owner');
  assert.equal(owned.room.id, 'room-1');
  assert.deepEqual(ownerRefusal({ status: 'unauthenticated' }), {
    status: 401,
    body: { ok: false, error: 'Требуется вход', code: 'authentication_required' }
  });
});

test('rename announces the update; delete finishes the teardown; both report a lost race', async () => {
  const renamed = roomsHarness({ updated: storedRoom({ id: 'room-1', name: 'New' }) });
  const renamedRoom = await renamed.service.rename('room-1', 'New');
  assert.equal(renamedRoom.status === 'renamed' && renamedRoom.room.name, 'New');
  assert.deepEqual(renamed.calls.announced, ['room-1']);
  assert.deepEqual(await roomsHarness().service.rename('room-1', 'New'), { status: 'not_found' });

  const removed = roomsHarness({ deleted: { avatarKey: 'a.webp' } });
  assert.deepEqual(await removed.service.remove('room-1', 'req' as never), { status: 'deleted' });
  assert.deepEqual(removed.calls.finished, [{ roomId: 'room-1', avatarKey: 'a.webp', request: 'req' }]);
  const noAvatar = roomsHarness({ deleted: {} });
  await noAvatar.service.remove('room-1', null);
  assert.equal(noAvatar.calls.finished[0]?.avatarKey, null);
  assert.deepEqual(await roomsHarness().service.remove('room-1', null), { status: 'not_found' });
});

// --- peer eviction ----------------------------------------------------------------

// What a finalizePeer call answered, or the error it failed with.
type FinalizeResult = { finalized?: boolean; message?: string; ownershipFinalized?: boolean };

function evictionHarness({
  store = {},
  ownedPeer = undefined,
  ownershipFinalized = false,
  removeFails = false,
  extraPeerIds = []
}: {
  store?: EvictionStore;
  ownedPeer?: PresencePeer;
  ownershipFinalized?: boolean;
  removeFails?: boolean;
  extraPeerIds?: string[];
} = {}) {
  const log: string[] = [];
  const results: FinalizeResult[] = [];
  const eviction = createPeerEviction({
    store: () => store,
    runtime: () => ({
      async finalizeReconnectPeers({ roomId, peerIds, reason, finalizePeer }) {
        log.push(`finalize:${roomId}:${reason}`);
        for (const peerId of [...peerIds, ...extraPeerIds]) {
          try {
            results.push(await finalizePeer({ peerId, peer: ownedPeer, ownershipFinalized }));
          } catch (error) {
            results.push(error as FinalizeResult);
          }
        }
      }
    }),
    notifyPeer: (peer, event) => log.push(`peer:${peer.id}:${event.type}`),
    notifyUser: (userId, event) => log.push(`user:${userId}:${event.type}`),
    detachVoiceConnections: (roomId, peerId) => log.push(`detach:${peerId}`),
    closePeer: (roomId, peerId, transportId, reason) => log.push(`close:${peerId}:${transportId}:${reason}`),
    removeParticipant: async (roomId, peerId) => {
      log.push(`remove:${peerId}`);
      if (removeFails) throw new Error('sfu down');
    }
  });
  return { eviction, log, results };
}

test('eviction revokes, notifies, closes, invalidates and removes in order', async () => {
  const revoked: unknown[] = [];
  const invalidated: unknown[] = [];
  const store: EvictionStore = {
    async revokeLiveKitGatePeer(input) {
      revoked.push(input);
    },
    async invalidatePeerIdentity(input) {
      invalidated.push(input);
    }
  };
  const { eviction, log } = evictionHarness({ store });
  await eviction.disconnect(
    { id: 'room-1' },
    { id: 'p1', accountUserId: 'u1', transport: { id: 't1', send: () => true } },
    'room.kicked'
  );
  assert.deepEqual(revoked, [{ roomId: 'room-1', peerId: 'p1', accountUserId: 'u1', guestPrincipalId: '' }]);
  assert.deepEqual(invalidated, [{ roomId: 'room-1', peerId: 'p1' }]);
  assert.deepEqual(log, [
    'finalize:room-1:room.kicked',
    'peer:p1:room.kicked',
    'user:u1:room.kicked',
    'detach:p1',
    'close:p1:t1:kicked',
    'remove:p1'
  ]);
});

test('a ban with pre-revoked credentials skips the revoke; a guest gets no account event', async () => {
  let revokes = 0;
  const { eviction, log } = evictionHarness({
    store: {
      async revokeLiveKitGatePeer() {
        revokes += 1;
      }
    }
  });
  await eviction.disconnect({ id: 'room-1' }, { id: 'g1', gateGuestPrincipalId: 'guest' }, 'room.banned', {
    gateAlreadyRevoked: true
  });
  assert.equal(revokes, 0);
  assert.deepEqual(log, [
    'finalize:room-1:room.banned',
    'peer:g1:room.banned',
    'detach:g1',
    'close:g1:undefined:banned',
    'remove:g1'
  ]);
});

test('eviction keeps going after a failed step and rethrows the first failure as finalized', async () => {
  const store: EvictionStore = {
    async revokeLiveKitGatePeer() {
      throw new Error('revoke failed');
    },
    async invalidatePeerIdentity() {
      throw new Error('invalidate failed');
    }
  };
  const { eviction, log, results } = evictionHarness({ store, removeFails: true });
  await eviction.finalize({ id: 'room-1' }, [{ id: 'p1' }], 'room.kicked');
  assert.equal(results[0]?.message, 'revoke failed');
  assert.equal(results[0].ownershipFinalized, true);
  assert.ok(log.includes('remove:p1'));

  const later = evictionHarness({
    store: {
      async invalidatePeerIdentity() {
        throw new Error('invalidate failed');
      }
    },
    removeFails: true
  });
  await later.eviction.finalize({ id: 'room-1' }, [{ id: 'p1' }], 'room.kicked');
  assert.equal(later.results[0]?.message, 'invalidate failed');

  const sfu = evictionHarness({ removeFails: true });
  await sfu.eviction.finalize({ id: 'room-1' }, [{ id: 'p1' }], 'room.kicked');
  assert.equal(sfu.results[0]?.message, 'sfu down');
});

test('a peer whose ownership is already final is only notified and invalidated', async () => {
  const { eviction, log, results } = evictionHarness({
    ownedPeer: { id: 'p1' },
    ownershipFinalized: true,
    extraPeerIds: ['ghost']
  });
  const outcome = await eviction.finalize({ id: 'room-1' }, [], 'room.kicked', {
    beforeFinalize: async () => 'persisted'
  });
  assert.equal(outcome, 'persisted');
  assert.deepEqual(log, ['finalize:room-1:room.kicked', 'peer:p1:room.kicked', 'detach:p1']);
  assert.deepEqual(results, [{ finalized: true }]);

  const unknown = evictionHarness({ ownershipFinalized: true, extraPeerIds: ['ghost'] });
  await unknown.eviction.finalize({ id: 'room-1' }, [], 'room.kicked');
  assert.deepEqual(unknown.results, [{ finalized: true }]);
});

// --- peer moderation ----------------------------------------------------------------

function moderationHarness({
  livekit = LOOSE,
  store = {},
  principal = (_roomId, peer) => ({
    principalType: peer.accountUserId ? 'account' : 'guest',
    principalId: peer.accountUserId || peer.id
  }),
  finalize = null
}: {
  livekit?: LiveKitConfig;
  store?: Partial<PeerModerationStore>;
  principal?: PeerModerationDeps['gatePrincipalForPeer'];
  finalize?: ((options: FinalizeOptions<unknown>) => Promise<unknown>) | null;
} = {}) {
  const calls = {
    evicted: [] as Array<{ peers: string[]; type: string; gateAlreadyRevoked?: boolean }>,
    disconnected: [] as unknown[],
    revoked: [] as string[],
    sfu: [] as unknown[],
    announced: [] as string[],
    notified: [] as unknown[],
    muteRow: undefined as { mutedBy?: string | null } | undefined,
    unmuteRow: undefined as unknown,
    ban: undefined as unknown,
    strictBan: undefined as { principals: unknown[] } | undefined,
    undo: undefined as unknown
  };
  const eviction = fake<PeerEviction>({
    finalize: (async (_room: unknown, peers: PresencePeer[], type: string, options: FinalizeOptions<unknown> = {}) => {
      calls.evicted.push({ peers: peers.map((peer) => peer.id), type, gateAlreadyRevoked: options.gateAlreadyRevoked });
      if (finalize) return finalize(options);
      return options.beforeFinalize ? options.beforeFinalize() : null;
    }) as PeerEviction['finalize'],
    async disconnect(_room, peer, type) {
      calls.disconnected.push({ peerId: peer.id, type });
    }
  });
  const service = createPeerModerationService({
    store: () => ({
      async setRoomServerMute(input) {
        calls.muteRow = input;
        return { status: 'muted' };
      },
      async clearRoomServerMute(input) {
        calls.unmuteRow = input;
        return { status: 'cleared' };
      },
      async createRoomBan(input) {
        calls.ban = input;
        return { status: 'created', ban: { id: 'ban-1' } };
      },
      async createRoomBanWithLiveKitGateRevocations(input) {
        calls.strictBan = input;
        return { status: 'created', ban: { id: 'ban-2' }, revocations: [{}] };
      },
      async deleteRoomBan(input) {
        calls.undo = input;
        return { status: input.banId === 'ban-1' ? 'deleted' : 'missing' };
      },
      ...store
    }),
    eviction,
    gatePrincipalForPeer: principal,
    livekitConfig: () => livekit,
    revokeForServerMute: async (input) => {
      calls.revoked.push(input.peerId);
    },
    setParticipantMuted: async (roomId, peerId, muted) => {
      calls.sfu.push([peerId, muted]);
      return { status: 'applied' };
    },
    announcePeerUpdated: (room, peer) => calls.announced.push(peer.id),
    notifyPeer: (peer, event) => calls.notified.push(event),
    maxBans: 5,
    logger: () => recordingLogger()
  });
  return { calls, service };
}

const ownerPeer: PresencePeer = { id: 'owner-peer', accountUserId: OWNER };
const accountPeer: PresencePeer = { id: 'acct-peer', accountUserId: 'user-1', ip: '10.0.0.1' };
const secondTab: PresencePeer = { id: 'acct-tab2', accountUserId: 'user-1', ip: '10.0.0.9' };
const guestPeer: PresencePeer = { id: 'guest-peer', ip: '10.0.0.1' };
const sameNatGuest: PresencePeer = { id: 'guest-nat', ip: '10.0.0.1' };
const noIpGuest: PresencePeer = { id: 'guest-noip' };

test('every peer action refuses an unknown peer and the room owner', async () => {
  const { service } = moderationHarness();
  const room = liveRoom({}, [ownerPeer]);
  for (const action of [
    (id: string) => service.kick(room, id),
    (id: string) => service.setServerMute(room, id, true),
    (id: string) => service.ban(room, id)
  ]) {
    assert.equal((await action('')).status, 'peer_not_found');
    assert.equal((await action('nobody')).status, 'peer_not_found');
    assert.equal((await action(ownerPeer.id)).status, 'owner');
  }
});

test('kick disconnects the target', async () => {
  const { calls, service } = moderationHarness();
  assert.deepEqual(await service.kick(liveRoom({}, [accountPeer]), accountPeer.id), { status: 'kicked' });
  assert.deepEqual(calls.disconnected, [{ peerId: accountPeer.id, type: 'room.kicked' }]);
});

test('server mute persists, revokes old credentials, narrows the SFU and tells everyone', async () => {
  const { calls, service } = moderationHarness();
  const peer: PresencePeer = { ...guestPeer, muted: false };
  const room = liveRoom({}, [peer]);
  assert.deepEqual(await service.setServerMute(room, peer.id, true), { status: 'applied', muted: true });
  assert.equal(peer.serverMuted, true);
  assert.equal(peer.muted, true);
  assert.equal(calls.muteRow?.mutedBy, OWNER);
  assert.deepEqual(calls.revoked, [peer.id]);
  assert.deepEqual(calls.sfu, [[peer.id, true]]);
  assert.deepEqual(calls.announced, [peer.id]);
  assert.deepEqual(calls.notified, []);

  // Lifting it leaves the participant's own mute alone and revokes nothing.
  assert.deepEqual(await service.setServerMute(room, peer.id, false), { status: 'applied', muted: false });
  assert.equal(peer.serverMuted, false);
  assert.equal(peer.muted, true);
  assert.deepEqual(calls.revoked, [peer.id]);
  assert.ok(calls.unmuteRow);
});

test('server mute is unsupported without a gate principal or when the store says invalid', async () => {
  const noPrincipal = moderationHarness({ principal: () => null });
  assert.equal(
    (await noPrincipal.service.setServerMute(liveRoom({}, [guestPeer]), guestPeer.id, true)).status,
    'unsupported'
  );
  const invalid = moderationHarness({
    store: {
      async setRoomServerMute() {
        return { status: 'invalid' };
      }
    }
  });
  assert.equal(
    (await invalid.service.setServerMute(liveRoom({}, [guestPeer]), guestPeer.id, true)).status,
    'unsupported'
  );
  assert.deepEqual(invalid.calls.sfu, []);
});

test('an account ban covers every tab of the account and never its IP', async () => {
  const { calls, service } = moderationHarness();
  const room = liveRoom({}, [accountPeer, secondTab, guestPeer]);
  assert.deepEqual(await service.ban(room, accountPeer.id), { status: 'banned', banId: 'ban-1', cleanupFailed: false });
  assert.deepEqual(calls.ban, { roomId: 'room-1', userId: 'user-1', ip: '', maxBans: 5 });
  assert.deepEqual(calls.evicted, [
    { peers: [accountPeer.id, secondTab.id], type: 'room.banned', gateAlreadyRevoked: false }
  ]);
});

test('a guest ban is IP-scoped', async () => {
  const { calls, service } = moderationHarness();
  const room = liveRoom({}, [guestPeer, sameNatGuest, accountPeer]);
  await service.ban(room, guestPeer.id);
  assert.deepEqual(calls.ban, { roomId: 'room-1', userId: null, ip: '10.0.0.1', maxBans: 5 });
  assert.deepEqual(calls.evicted[0]?.peers, [guestPeer.id, sameNatGuest.id, accountPeer.id]);
});

test('with the strict gate the ban and the revocations commit together', async () => {
  const { calls, service } = moderationHarness({ livekit: STRICT });
  const room = liveRoom({}, [accountPeer, secondTab]);
  assert.deepEqual(await service.ban(room, accountPeer.id), { status: 'banned', banId: 'ban-2', cleanupFailed: false });
  assert.equal(calls.ban, undefined);
  assert.deepEqual(calls.strictBan?.principals, [
    { principalType: 'account', principalId: 'user-1' },
    { principalType: 'account', principalId: 'user-1' }
  ]);
  assert.equal(calls.evicted[0]?.gateAlreadyRevoked, true);
});

test('strict ban refusals: a peer without a principal, nobody to revoke, no transactional store', async () => {
  const missing = moderationHarness({ livekit: STRICT, principal: () => null });
  assert.equal((await missing.service.ban(liveRoom({}, [accountPeer]), accountPeer.id)).status, 'principal_missing');
  const nobody = moderationHarness({ livekit: STRICT });
  assert.equal((await nobody.service.ban(liveRoom({}, [noIpGuest]), noIpGuest.id)).status, 'revoke_unavailable');
  const noStore = moderationHarness({ livekit: STRICT, store: { createRoomBanWithLiveKitGateRevocations: undefined } });
  assert.equal((await noStore.service.ban(liveRoom({}, [accountPeer]), accountPeer.id)).status, 'revoke_unavailable');
});

test('ban persistence refusals map to limit, rejected and failed', async () => {
  const room = () => liveRoom({}, [accountPeer]);
  const limit = moderationHarness({
    store: {
      async createRoomBan() {
        return { status: 'cap_exceeded' };
      }
    }
  });
  assert.equal((await limit.service.ban(room(), accountPeer.id)).status, 'ban_limit');
  const rejected = moderationHarness({
    store: {
      async createRoomBan() {
        return { status: 'created', ban: null };
      }
    }
  });
  assert.equal((await rejected.service.ban(room(), accountPeer.id)).status, 'ban_rejected');
  const noRevocations = moderationHarness({
    livekit: STRICT,
    store: {
      async createRoomBanWithLiveKitGateRevocations() {
        return { status: 'created', ban: { id: 'b' }, revocations: [] };
      }
    }
  });
  assert.equal((await noRevocations.service.ban(room(), accountPeer.id)).status, 'ban_rejected');
  // Set by the store when it fails; the service marks it.
  const failure: { error?: Error & { rollbackTerminal?: boolean } } = {};
  const broken = moderationHarness({
    store: {
      async createRoomBan() {
        failure.error = new Error('db down');
        throw failure.error;
      }
    }
  });
  assert.equal((await broken.service.ban(room(), accountPeer.id)).status, 'ban_failed');
  assert.equal(failure.error?.rollbackTerminal, true);
});

test('a durable ban whose peer cleanup failed is still reported as banned', async () => {
  const { service } = moderationHarness({
    finalize: async (options) => {
      await options.beforeFinalize?.();
      throw new Error('cleanup failed');
    }
  });
  assert.deepEqual(await service.ban(liveRoom({}, [accountPeer]), accountPeer.id), {
    status: 'banned',
    banId: 'ban-1',
    cleanupFailed: true
  });
});

test('a ban that never reached persistence is a failure', async () => {
  const { service } = moderationHarness({ finalize: async () => null });
  assert.equal((await service.ban(liveRoom({}, [noIpGuest]), noIpGuest.id)).status, 'ban_failed');
});

test('undo ban reports whether the ban existed', async () => {
  const { calls, service } = moderationHarness();
  assert.deepEqual(await service.undoBan('room-1', 'ban-1'), { status: 'deleted' });
  assert.deepEqual(calls.undo, { roomId: 'room-1', banId: 'ban-1' });
  assert.deepEqual(await service.undoBan('room-1', 'ban-9'), { status: 'not_found' });
});

// --- routes -------------------------------------------------------------------------

type RouteOptions = {
  user?: string | null;
  room?: LiveRoom | null;
  bans?: boolean | ((userId: string | null | undefined, ip: string) => boolean);
  peer?: PresencePeer | null;
  created?: CreateRoomResult | null;
  renamed?: unknown;
  removed?: unknown;
  list?: StoredRoom[];
  added?: { status: string; room?: StoredRoom | null } | null;
  removedBookmark?: { status: string; removed?: boolean } | null;
  rate?: { allowed: boolean; retryAfterSeconds?: number };
  proof?: PowVerdict;
  moderation?: { kick?: unknown; mute?: unknown; ban?: unknown; undo?: unknown };
};

function routeApp(
  t: TestContext,
  {
    user = null,
    room = null,
    bans = false,
    peer = null,
    created = null,
    renamed = null,
    removed = null,
    list = [],
    added = null,
    removedBookmark = null,
    rate = { allowed: true },
    proof = { ok: true },
    moderation = {}
  }: RouteOptions = {}
) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const calls = {
    created: [] as Array<{ ownerId?: string | null }>,
    invalidated: [] as string[],
    banLookups: [] as unknown[][]
  };
  const ctx: ApiContext = {
    logger: fake<ApiContext['logger']>(),
    clientIp: () => '203.0.113.1',
    resolveSession: async () => (user ? { user: storedUser({ id: user }) } : null),
    hashIp: (ip: string) => ip
  };
  const rooms = fake<RoomsService>({
    async createRoom(input: Parameters<RoomsService['createRoom']>[0]) {
      calls.created.push(input);
      return (
        created || {
          status: 'created',
          room: { id: 'new-room', createdAt: 5, isStatic: input.isStatic, name: input.name, ownerId: input.ownerId }
        }
      );
    },
    async checkOwner(userId: string | null | undefined, roomId: string) {
      if (!userId) return { status: 'unauthenticated' };
      if (!room || room.id !== roomId) return { status: 'not_found' };
      return room.ownerId === userId ? { status: 'owner', room } : { status: 'forbidden' };
    },
    async rename(roomId: string, name: string) {
      return renamed || { status: 'renamed', room: publicLobbyRoom(storedRoom({ id: roomId, name }), 0) };
    },
    async remove() {
      return removed || { status: 'deleted' };
    }
  } as Partial<Record<keyof RoomsService, unknown>> as Partial<RoomsService>);
  registerRoomRoutes(app, ctx, {
    rooms,
    store: () => ({
      async listVisibleRoomsForUser() {
        return list;
      },
      async addRoomBookmarkForUser() {
        return added as never;
      },
      async removeRoomBookmarkForUser() {
        return removedBookmark as never;
      }
    }),
    getRoom: async (roomId) => (room && room.id === roomId ? room : null),
    findRoomBan: async (roomId, userId, ip) => {
      calls.banLookups.push([userId, ip]);
      return typeof bans === 'function' ? bans(userId, ip) : bans;
    },
    findAuthorizedPeer: (roomId, peerId, token) =>
      peer && peer.id === peerId && token === 't'.repeat(32) ? peer : null,
    lobbyRoom: (value) => publicLobbyRoom(value, 0),
    invalidateRecipientCache: (roomId) => calls.invalidated.push(roomId),
    createLimiter: { check: () => rate },
    pow: { verify: () => proof },
    maxRooms: 100,
    maxRoomPeers: 12
  });
  registerPeerModerationRoutes(app, ctx, {
    rooms,
    moderation: fake<PeerModerationService>({
      kick: async () => moderation.kick || { status: 'kicked' },
      setServerMute: async (_room: unknown, _peerId: unknown, muted: boolean) =>
        moderation.mute || { status: 'applied', muted },
      ban: async () => moderation.ban || { status: 'banned', banId: 'ban-1', cleanupFailed: false },
      undoBan: async () => moderation.undo || { status: 'deleted' }
    } as Partial<Record<keyof PeerModerationService, unknown>> as Partial<PeerModerationService>)
  });
  t.after(() => app.close());
  return { app, calls };
}

type Body = {
  ok?: boolean;
  error?: string;
  code?: string;
  owned?: boolean;
  name?: string;
  peer?: { id: string };
  peers?: Array<{ id: string }>;
} & Record<string, unknown>;

async function call(app: FastifyInstance, method: string, url: string, payload?: object) {
  const response = await app.inject({
    method: method as 'GET' | 'PUT' | 'POST' | 'DELETE',
    url,
    ...(payload === undefined ? {} : { payload })
  });
  return { status: response.statusCode, body: response.json<Body>(), headers: response.headers };
}

test('POST /api/rooms: rate limit, proof, login for persistent rooms and store refusals', async (t) => {
  const limited = routeApp(t, { rate: { allowed: false, retryAfterSeconds: 7 } });
  const tooMany = await call(limited.app, 'POST', '/api/rooms', {});
  assert.equal(tooMany.status, 429);
  assert.equal(tooMany.headers['retry-after'], '7');

  const badProof = routeApp(t, {
    proof: { ok: false, status: 403, error: 'Invalid room creation proof', code: 'pow_invalid' }
  });
  assert.deepEqual(await call(badProof.app, 'POST', '/api/rooms', {}).then((r) => [r.status, r.body]), [
    403,
    { ok: false, error: 'Invalid room creation proof', code: 'pow_invalid' }
  ]);

  const guest = routeApp(t);
  assert.equal((await call(guest.app, 'POST', '/api/rooms', { isStatic: 'true' })).status, 401);
  assert.deepEqual(guest.calls.created, []);

  const cases: Array<[CreateRoomResult, boolean, number, string]> = [
    [{ status: 'auth_required' }, true, 401, 'Требуется вход для создания постоянной комнаты'],
    [{ status: 'quota_exceeded' }, true, 429, 'Можно владеть максимум 3 постоянными комнатами'],
    [{ status: 'quota_exceeded' }, false, 429, 'Too many temporary rooms waiting from this IP, reuse one or try later'],
    [{ status: 'capacity_exceeded' }, false, 503, 'Room capacity is temporarily full']
  ];
  for (const [created, isStatic, status, error] of cases) {
    const { app } = routeApp(t, { user: OWNER, created });
    const response = await call(app, 'POST', '/api/rooms', { isStatic });
    assert.equal(response.status, status);
    assert.equal(response.body.error, error);
  }
});

test('POST /api/rooms creates temporary and persistent rooms', async (t) => {
  const { app, calls } = routeApp(t, { user: OWNER });
  const temporary = await call(app, 'POST', '/api/rooms');
  assert.equal(temporary.status, 201);
  assert.deepEqual(temporary.body, {
    ok: true,
    avatarUrl: null,
    createdAt: 5,
    maxRooms: 100,
    maxRoomPeers: 12,
    isStatic: false,
    name: '',
    owned: false,
    roomId: 'new-room'
  });
  const persistent = await call(app, 'POST', '/api/rooms', { isStatic: 1, name: '  Team  ' });
  assert.equal(persistent.body.owned, true);
  assert.equal(persistent.body.name, 'Team');
  assert.deepEqual(
    calls.created.map((input) => input.ownerId),
    [null, OWNER]
  );
});

test('room mutations answer the owner check first', async (t) => {
  const room = liveRoom({}, [accountPeer]);
  const routes: Array<[string, string, object | undefined]> = [
    ['PUT', '/api/rooms/room-1', { name: 'x' }],
    ['DELETE', '/api/rooms/room-1', undefined],
    ['POST', '/api/rooms/room-1/kick', { peerId: accountPeer.id }],
    ['POST', '/api/rooms/room-1/server-mute', { peerId: accountPeer.id }],
    ['POST', '/api/rooms/room-1/ban', { peerId: accountPeer.id }],
    ['DELETE', '/api/rooms/room-1/bans/ban-1', undefined]
  ];
  const refusals: Array<[string | null, LiveRoom | null, number, string, string]> = [
    [null, room, 401, 'Требуется вход', 'authentication_required'],
    [OWNER, null, 404, 'Комната не найдена', 'room_not_found'],
    ['someone', room, 403, 'Недостаточно прав', 'forbidden']
  ];
  for (const [user, currentRoom, status, error, code] of refusals) {
    const { app } = routeApp(t, { user, room: currentRoom });
    for (const [method, url, payload] of routes) {
      const response = await call(app, method, url, payload);
      assert.equal(response.status, status, `${method} ${url}`);
      assert.deepEqual(response.body, { ok: false, error, code });
    }
  }
});

test('PUT and DELETE /api/rooms/:roomId', async (t) => {
  const room = liveRoom();
  const ok = routeApp(t, { user: OWNER, room });
  assert.deepEqual((await call(ok.app, 'PUT', '/api/rooms/room-1', { name: ' New ' })).body, {
    ok: true,
    room: publicLobbyRoom(storedRoom({ id: 'room-1', name: 'New' }), 0)
  });
  assert.deepEqual((await call(ok.app, 'PUT', '/api/rooms/room-1')).body, {
    ok: true,
    room: publicLobbyRoom(storedRoom({ id: 'room-1', name: 'Room' }), 0)
  });
  assert.deepEqual(
    await call(ok.app, 'PUT', '/api/rooms/room-1', { name: '   ' }).then((r) => [r.status, r.body.error]),
    [400, 'Дайте комнате название']
  );
  assert.deepEqual((await call(ok.app, 'DELETE', '/api/rooms/room-1')).body, { ok: true });

  const raced = routeApp(t, { user: OWNER, room, renamed: { status: 'not_found' }, removed: { status: 'not_found' } });
  assert.equal((await call(raced.app, 'PUT', '/api/rooms/room-1', { name: 'x' })).status, 404);
  assert.equal((await call(raced.app, 'DELETE', '/api/rooms/room-1')).status, 404);
});

test('GET /api/rooms/:roomId is the public status card', async (t) => {
  const { app } = routeApp(t, { room: liveRoom({ avatarKey: 'a.webp', emptySince: 9 }, [accountPeer]) });
  assert.deepEqual((await call(app, 'GET', '/api/rooms/room-1')).body, {
    ok: true,
    avatarUrl: '/api/avatars/a.webp',
    createdAt: 1,
    exists: true,
    emptySince: 9,
    isStatic: true,
    maxRoomPeers: 12,
    name: 'Room',
    peers: 1,
    roomId: 'room-1'
  });
  assert.deepEqual(await call(app, 'GET', '/api/rooms/other-room').then((r) => [r.status, r.body]), [
    404,
    { ok: false, error: 'Room not found', code: 'room_not_found', exists: false, roomId: 'other-room' }
  ]);
  assert.deepEqual((await call(app, 'GET', '/api/rooms/%20')).body, {
    ok: false,
    error: 'Room not found',
    code: 'room_not_found',
    exists: false
  });
});

test('GET /api/rooms/:roomId/peers hides the roster from banned viewers', async (t) => {
  const room = liveRoom({}, [accountPeer]);
  const open = routeApp(t, { room, user: 'viewer' });
  const peers = await call(open.app, 'GET', '/api/rooms/room-1/peers');
  assert.equal(peers.body.peers?.[0]?.id, accountPeer.id);
  assert.equal('ip' in (peers.body.peers?.[0] ?? {}), false);
  assert.deepEqual(open.calls.banLookups, [['viewer', '203.0.113.1']]);
  assert.equal((await call(open.app, 'GET', '/api/rooms/nope-room/peers')).status, 404);
  const banned = routeApp(t, { room, bans: true });
  assert.deepEqual(await call(banned.app, 'GET', '/api/rooms/room-1/peers').then((r) => [r.status, r.body.code]), [
    403,
    'room_banned'
  ]);
});

test('POST /api/state reads the peer and refuses writes, bans and foreign sessions', async (t) => {
  const peer: PresencePeer = { ...accountPeer, id: 'peer0001', sessionToken: 't'.repeat(32) };
  const request = { roomId: 'room-1', peerId: 'peer0001', sessionToken: 't'.repeat(32) };
  const { app } = routeApp(t, { peer });
  const read = await call(app, 'POST', '/api/state', request);
  assert.equal(read.status, 200);
  assert.equal(read.body.peer?.id, 'peer0001');
  assert.equal('sessionToken' in (read.body.peer ?? {}), false);
  const write = await call(app, 'POST', '/api/state', { ...request, muted: true });
  assert.deepEqual([write.status, write.body.code], [409, 'state_updates_require_websocket']);
  assert.deepEqual(
    await call(app, 'POST', '/api/state', { ...request, sessionToken: 'u'.repeat(32) }).then((r) => [
      r.status,
      r.body.error
    ]),
    [403, 'Invalid peer session']
  );
  assert.equal((await call(app, 'POST', '/api/state')).status, 403);

  const requesterBanned = routeApp(t, { peer, bans: (userId) => userId === null });
  assert.equal((await call(requesterBanned.app, 'POST', '/api/state', request)).body.code, 'room_banned');
  const peerBanned = routeApp(t, { peer, bans: (userId) => userId === 'user-1' });
  assert.equal((await call(peerBanned.app, 'POST', '/api/state', request)).body.code, 'room_banned');
  const peerWithoutIp = routeApp(t, {
    peer: { ...peer, ip: undefined },
    bans: (userId, ip) => userId === 'user-1' && ip !== ''
  });
  assert.equal((await call(peerWithoutIp.app, 'POST', '/api/state', request)).status, 200);
});

test('the account room list, adding and removing a room', async (t) => {
  const anonymous = routeApp(t);
  for (const [method, url] of [
    ['GET', '/api/auth/rooms'],
    ['POST', '/api/auth/rooms'],
    ['DELETE', '/api/auth/rooms/room-1']
  ] as const) {
    assert.equal((await call(anonymous.app, method, url, method === 'POST' ? {} : undefined)).status, 401);
  }

  const listed = routeApp(t, { user: OWNER, list: [storedRoom({ id: 'room-1' }), storedRoom({ id: 'room-2' })] });
  assert.deepEqual((await call(listed.app, 'GET', '/api/auth/rooms')).body, {
    ok: true,
    rooms: [publicLobbyRoom(storedRoom({ id: 'room-1' }), 0), publicLobbyRoom(storedRoom({ id: 'room-2' }), 0)]
  });

  const adding = routeApp(t, { user: OWNER, added: { status: 'added', room: storedRoom({ id: 'room-1' }) } });
  assert.deepEqual(await call(adding.app, 'POST', '/api/auth/rooms', {}).then((r) => [r.status, r.body.error]), [
    400,
    'Неверный код комнаты'
  ]);
  for (const key of ['roomId', 'code', 'roomCode']) {
    assert.deepEqual((await call(adding.app, 'POST', '/api/auth/rooms', { [key]: 'room-1' })).body, {
      ok: true,
      room: publicLobbyRoom(storedRoom({ id: 'room-1' }), 0)
    });
  }
  assert.deepEqual(adding.calls.invalidated, ['room-1', 'room-1', 'room-1']);
  const missing = routeApp(t, { user: OWNER, added: { status: 'not_found' } });
  assert.equal((await call(missing.app, 'POST', '/api/auth/rooms', { roomId: 'room-1' })).status, 404);
  const temporary = routeApp(t, { user: OWNER, added: { status: 'temporary_room' } });
  assert.deepEqual(
    await call(temporary.app, 'POST', '/api/auth/rooms', { roomId: 'room-1' }).then((r) => [r.status, r.body.error]),
    [400, 'В список можно добавить только постоянную комнату']
  );

  const removing = routeApp(t, { user: OWNER, removedBookmark: { status: 'removed', removed: true } });
  assert.deepEqual((await call(removing.app, 'DELETE', '/api/auth/rooms/room-1')).body, { ok: true, removed: true });
  assert.equal((await call(removing.app, 'DELETE', '/api/auth/rooms/%20')).status, 404);
  const owner = routeApp(t, { user: OWNER, removedBookmark: { status: 'owner' } });
  assert.deepEqual((await call(owner.app, 'DELETE', '/api/auth/rooms/room-1')).body, {
    ok: false,
    error: 'Владелец управляет комнатой через настройки',
    code: 'room_owner'
  });
});

test('the owner menu maps every moderation outcome to its HTTP answer', async (t) => {
  const room = liveRoom({}, [accountPeer]);
  const cases: Array<[string, { status: string }, number, string]> = [
    ['kick', { status: 'peer_not_found' }, 404, 'Участник не найден'],
    ['kick', { status: 'owner' }, 400, 'Нельзя исключить владельца комнаты'],
    ['server-mute', { status: 'peer_not_found' }, 404, 'Участник не найден'],
    ['server-mute', { status: 'owner' }, 400, 'Нельзя выключить микрофон владельцу комнаты'],
    ['server-mute', { status: 'unsupported' }, 400, 'Участник не поддерживает модерацию микрофона'],
    ['ban', { status: 'peer_not_found' }, 404, 'Участник не найден'],
    ['ban', { status: 'owner' }, 400, 'Нельзя заблокировать владельца комнаты'],
    ['ban', { status: 'ban_limit' }, 409, 'Достигнут лимит блокировок комнаты'],
    ['ban', { status: 'ban_rejected' }, 409, 'Не удалось сохранить блокировку'],
    ['ban', { status: 'ban_failed' }, 500, 'Не удалось сохранить блокировку'],
    ['ban', { status: 'principal_missing' }, 500, 'Не удалось отозвать доступ участника'],
    ['ban', { status: 'revoke_unavailable' }, 500, 'Не удалось отозвать доступ участника']
  ];
  const keys: Record<string, string> = { kick: 'kick', 'server-mute': 'mute', ban: 'ban' };
  for (const [action, outcome, status, error] of cases) {
    const { app } = routeApp(t, { user: OWNER, room, moderation: { [keys[action] ?? action]: outcome } });
    const response = await call(app, 'POST', `/api/rooms/room-1/${action}`, { peerId: accountPeer.id });
    assert.equal(response.status, status, `${action} ${outcome.status}`);
    assert.equal(response.body.error, error);
  }

  const ok = routeApp(t, { user: OWNER, room });
  assert.deepEqual((await call(ok.app, 'POST', '/api/rooms/room-1/kick', { peerId: accountPeer.id })).body, {
    ok: true
  });
  assert.deepEqual((await call(ok.app, 'POST', '/api/rooms/room-1/server-mute', { peerId: accountPeer.id })).body, {
    ok: true,
    muted: true
  });
  assert.deepEqual(
    (await call(ok.app, 'POST', '/api/rooms/room-1/server-mute', { peerId: accountPeer.id, muted: false })).body,
    { ok: true, muted: false }
  );
  assert.deepEqual(
    await call(ok.app, 'POST', '/api/rooms/room-1/ban', { peerId: accountPeer.id }).then((r) => [r.status, r.body]),
    [201, { ok: true, banId: 'ban-1' }]
  );
  assert.deepEqual((await call(ok.app, 'DELETE', '/api/rooms/room-1/bans/ban-1')).body, { ok: true });

  const cleanup = routeApp(t, {
    user: OWNER,
    room,
    moderation: { ban: { status: 'banned', banId: 'ban-7', cleanupFailed: true }, undo: { status: 'not_found' } }
  });
  assert.deepEqual(
    await call(cleanup.app, 'POST', '/api/rooms/room-1/ban', { peerId: accountPeer.id }).then((r) => [
      r.status,
      r.body
    ]),
    [201, { ok: true, banId: 'ban-7' }]
  );
  assert.deepEqual(
    await call(cleanup.app, 'DELETE', '/api/rooms/room-1/bans/ban-9').then((r) => [r.status, r.body.error]),
    [404, 'Блокировка не найдена']
  );
});
