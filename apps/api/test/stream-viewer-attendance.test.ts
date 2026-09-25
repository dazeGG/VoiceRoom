import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId,
  type RoomRuntimeDeps,
  type RuntimeRoomStore
} from '../src/realtime/room-runtime.ts';
import type { ConnectionRegistry, WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';

const ROOM_ID = 'room1';
const OWNER_ID = 'peer-owner1';
const VIEWER_ID = 'peer-viewer1';
const OWNER_TOKEN = 'o'.repeat(32);
const VIEWER_TOKEN = 'v'.repeat(32);

// The runtime's in-memory room and peer records.
type TestRoom = NonNullable<Parameters<typeof resolveViewedScreenPeerId>[0]>;
type TestPeer = TestRoom['peers'] extends Map<string, infer Peer> ? Peer : never;
type LogRecord = { level: string; msg?: string } & Record<string, unknown>;
type Broadcast = { type?: string; peer: { id: string; screen?: unknown; viewedScreenPeerId?: unknown } };
// Settles a promise the test holds open.
type Settle = (value?: unknown) => void;
type Closed = { roomId: string; peerId: string; transportId: string | undefined; reason: string };

function createPeer(id: string, overrides: Record<string, unknown> = {}): TestPeer {
  return {
    id,
    name: id,
    screen: false,
    sessionToken: id === OWNER_ID ? OWNER_TOKEN : VIEWER_TOKEN,
    transport: { id: `transport-${id}` },
    viewedScreenPeerId: '',
    ...overrides
  };
}

// The runtime logs through an injected logger, so a test that asserts a failure
// was observed records the structured fields instead of the console.
function createCapturingLogger(records: LogRecord[]) {
  const record = (level: string) => (fields: Record<string, unknown>, msg?: string) =>
    records.push({ level, ...fields, msg });
  return {
    debug: record('debug'),
    error: record('error'),
    fatal: record('fatal'),
    info: record('info'),
    trace: record('trace'),
    warn: record('warn')
  };
}

type RuntimeOverrides = Partial<Omit<RoomRuntimeDeps, 'wsRegistry' | 'logger'>> & {
  store?: Partial<Record<keyof RuntimeRoomStore, unknown>>;
  wsRegistry?: Partial<ConnectionRegistry>;
  logger?: unknown;
};

function createRuntime(room: TestRoom, broadcasts: unknown[], overrides: RuntimeOverrides = {}) {
  const store = fake<RuntimeRoomStore>({
    async getRoom() {
      return null;
    },
    async isRoomServerMuted() {
      return false;
    },
    async listMessages() {
      return [];
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    normalizeGatePrincipal(input) {
      return input?.accountUserId
        ? { principalId: input.accountUserId as string, principalType: 'account' }
        : { principalId: input?.guestPrincipalId as string, principalType: 'guest' };
    },
    ...(overrides.store as Partial<RuntimeRoomStore>)
  });
  const wsRegistry = fake<ConnectionRegistry>({
    registerConnectionForRoom() {},
    roomDetailSubscribers() {
      return new Set();
    },
    sendToConnection() {
      return false;
    },
    sendToUser() {
      return 0;
    },
    unregisterConnectionForRoom() {},
    unregisterConnectionFromAllRooms() {},
    ...overrides.wsRegistry
  });
  return createRoomRealtimeRuntime({
    presenceRooms: overrides.presenceRooms || new Map([[room.id as string, room]]),
    wsRegistry,
    logger: overrides.logger as RoomRuntimeDeps['logger'],
    getRoomStore: () => store,
    getRoom: overrides.getRoom || (async () => room),
    publicPeer: (peer: TestPeer) => ({
      id: peer.id,
      name: peer.name as unknown,
      screen: peer.screen as unknown,
      viewedScreenPeerId: peer.viewedScreenPeerId as unknown
    }),
    publicLobbyRoom: (value: unknown) => value,
    publicChatMessage: (value: unknown) => value,
    broadcast: (_room, message) => broadcasts.push(structuredClone(message)),
    closePeer: overrides.closePeer || (() => {}),
    avatarColorForPeerId: () => 'blue',
    MAX_ROOM_PEERS: 16,
    tokensMatch: (expected, actual) => expected === actual,
    sessionAvatarColorKey: () => 'blue',
    queueRoomOccupancyTransition: overrides.queueRoomOccupancyTransition || (async () => {}),
    findRoomBan: overrides.findRoomBan || (async () => null),
    credentialBoundary: overrides.credentialBoundary,
    removeLiveKitParticipant: overrides.removeLiveKitParticipant,
    now: overrides.now,
    setTimeout: overrides.setTimeout,
    clearTimeout: overrides.clearTimeout,
    reconnectLeaseMs: overrides.reconnectLeaseMs
  });
}

function createManualScheduler() {
  let currentTime = 0;
  let nextId = 0;
  const tasks = new Map<number, { callback: () => void; at: number }>();
  return {
    now: () => currentTime,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++nextId;
      tasks.set(id, { callback, at: currentTime + delay });
      return id;
    },
    clearTimeout: (id: number) => {
      tasks.delete(id);
    },
    advance(ms: number) {
      currentTime += ms;
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= currentTime)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, task] of due) {
        if (!tasks.delete(id)) continue;
        task.callback();
      }
    },
    callbacks() {
      return [...tasks.values()].map((task) => task.callback);
    },
    size: () => tasks.size
  };
}

type Scheduler = ReturnType<typeof createManualScheduler>;

function createVoiceConnection(activeVoice: Record<string, unknown> | null = null) {
  return fake<WsConnection>({
    activeVoice: activeVoice as WsConnection['activeVoice'],
    closed: false,
    pendingVoiceJoin: null,
    previewRoomIds: new Set()
  });
}

function createLeaseRuntime({
  room,
  scheduler,
  revoked = [],
  closed = [],
  removeCalls = [],
  getRoom,
  findRoomBan,
  credentialBoundary,
  store = {}
}: {
  room: TestRoom;
  scheduler: Scheduler;
  revoked?: unknown[];
  closed?: Closed[];
  removeCalls?: unknown[];
  getRoom?: RoomRuntimeDeps['getRoom'];
  findRoomBan?: RoomRuntimeDeps['findRoomBan'];
  credentialBoundary?: RoomRuntimeDeps['credentialBoundary'];
  store?: RuntimeOverrides['store'];
}) {
  return createRuntime(room, [], {
    getRoom: getRoom || (async () => room),
    findRoomBan,
    closePeer(roomId, peerId, transportId, reason) {
      closed.push({ roomId, peerId, transportId, reason });
      const current = room.peers.get(peerId);
      if (current?.transport?.id === transportId) room.peers.delete(peerId);
    },
    credentialBoundary: credentialBoundary || {
      async revokePeer(value) {
        revoked.push(value);
        return { status: 'revoked' };
      }
    },
    removeLiveKitParticipant: async (...args: unknown[]) => removeCalls.push(args),
    now: scheduler.now,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    reconnectLeaseMs: 1000,
    store: {
      async getOrCreatePeerIdentity({ peerId }: { peerId: string }) {
        return { status: 'ok', identity: { id: `identity-${peerId}`, avatarColorKey: 'blue' } };
      },
      ...store
    }
  });
}

test('reconnect restores persisted server mute for the account principal', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const lookups: Array<{ principal?: unknown }> = [];
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return room;
      },
      async getOrCreatePeerIdentity({ peerId }: { peerId: string }) {
        return { status: 'ok', identity: { id: `identity-${peerId}`, avatarColorKey: 'blue' } };
      },
      async isRoomServerMuted(input: { principal?: unknown }) {
        lookups.push(input);
        return true;
      }
    }
  });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN, name: 'Owner' };
  const sessionUser = { id: 'account-owner', displayName: 'Owner' };

  assert.equal((await runtime.joinVoiceRoom(createVoiceConnection(), payload, sessionUser)).ok, true);
  assert.equal((await runtime.joinVoiceRoom(createVoiceConnection(), payload, sessionUser)).ok, true);

  assert.equal(lookups.length, 2);
  assert.deepEqual(lookups[1]?.principal, { principalId: 'account-owner', principalType: 'account' });
  assert.equal(room.peers.get(OWNER_ID)?.serverMuted, true);
  assert.equal(room.peers.get(OWNER_ID)?.muted, true);
});

test('reconnect returns a terminal error when persisted server-mute authority is unavailable', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return room;
      },
      async getOrCreatePeerIdentity({ peerId }: { peerId: string }) {
        return { status: 'ok', identity: { id: `identity-${peerId}`, avatarColorKey: 'blue' } };
      },
      async isRoomServerMuted() {
        throw new Error('database unavailable');
      }
    }
  });

  const result = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    { id: 'account-owner', displayName: 'Owner' }
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'server_mute_unavailable',
    message: 'Не удалось проверить ограничения микрофона. Попробуйте ещё раз.'
  });
  assert.equal(room.peers.size, 0);
});

test('attendance only accepts an active remote screen owner', () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID);
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer]
    ])
  };

  assert.equal(resolveViewedScreenPeerId(room, viewer.id, owner.id), owner.id);
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, viewer.id), '');
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, 'missing-peer'), '');

  owner.screen = false;
  assert.equal(resolveViewedScreenPeerId(room, viewer.id, owner.id), '');
});

test('owner removal clears every viewer that still references the stream', () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const otherViewer = createPeer('peer-viewer2', {
    sessionToken: 'w'.repeat(32),
    viewedScreenPeerId: OWNER_ID
  });
  const unrelated = createPeer('peer-viewer3', {
    sessionToken: 'x'.repeat(32),
    viewedScreenPeerId: 'peer-other1'
  });
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer],
      [otherViewer.id, otherViewer],
      [unrelated.id, unrelated]
    ])
  };

  room.peers.delete(owner.id);
  const cleared = clearViewedScreenPeerReferences(room, owner.id);

  assert.deepEqual(
    cleared.map((peer) => peer.id),
    [viewer.id, otherViewer.id]
  );
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.equal(otherViewer.viewedScreenPeerId, '');
  assert.equal(unrelated.viewedScreenPeerId, 'peer-other1');
});

test('screen stop publishes viewer leave and rejects a stale re-entry', async () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer]
    ])
  };
  const broadcasts: Broadcast[] = [];
  const runtime = createRuntime(room, broadcasts);

  const stopped = await runtime.updatePeerState(
    fake<WsConnection>({ activeVoice: { roomId: ROOM_ID, peerId: OWNER_ID, transportId: owner.transport.id } }),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      patch: { screen: false }
    }
  );

  assert.equal(stopped.ok, true);
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.deepEqual(
    broadcasts.map((message) => [message.peer.id, message.peer.screen, message.peer.viewedScreenPeerId]),
    [
      [VIEWER_ID, false, ''],
      [OWNER_ID, false, '']
    ]
  );

  broadcasts.length = 0;
  const staleEntry = await runtime.updatePeerState(
    fake<WsConnection>({ activeVoice: { roomId: ROOM_ID, peerId: VIEWER_ID, transportId: viewer.transport.id } }),
    {
      roomId: ROOM_ID,
      peerId: VIEWER_ID,
      sessionToken: VIEWER_TOKEN,
      patch: { viewedScreenPeerId: OWNER_ID }
    }
  );

  assert.equal(staleEntry.ok, true);
  assert.equal(viewer.viewedScreenPeerId, '');
  assert.equal(broadcasts.at(-1)?.peer.viewedScreenPeerId, '');
});

test('superseded transport cannot stop the replacement peer stream', async () => {
  const owner = createPeer(OWNER_ID, { screen: true, transport: { id: 'new-transport' } });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer]
    ])
  };
  const broadcasts: Broadcast[] = [];
  const runtime = createRuntime(room, broadcasts);

  const result = await runtime.updatePeerState(
    fake<WsConnection>({ activeVoice: { roomId: ROOM_ID, peerId: OWNER_ID, transportId: 'old-transport' } }),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      patch: { screen: false }
    }
  );

  assert.deepEqual(result, { ok: false, code: 'not_active_peer' });
  assert.equal(owner.screen, true);
  assert.equal(viewer.viewedScreenPeerId, OWNER_ID);
  assert.deepEqual(broadcasts, []);
});

test('newer concurrent join wins even when its identity lookup finishes first', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const identityLookups: Array<{ request: { displayName?: string }; resolve: (value: unknown) => void }> = [];
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async getOrCreatePeerIdentity(request: { displayName?: string }) {
        return new Promise((resolve) => identityLookups.push({ request, resolve }));
      }
    }
  });
  const firstConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const secondConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (identityLookups.length < 2) await Promise.resolve();

  const secondLookup = identityLookups.find(({ request }) => request.displayName === 'Second');
  assert.ok(secondLookup);
  secondLookup.resolve({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const secondResult = await secondJoin;

  const firstLookup = identityLookups.find(({ request }) => request.displayName === 'First');
  assert.ok(firstLookup);
  firstLookup.resolve({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(room.peers.get(OWNER_ID)?.transport.id, secondConnection.activeVoice?.transportId);
});

test('older join cannot replace a newer join after a delayed room lookup', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const roomLookups: Array<(room: TestRoom) => void> = [];
  const runtime = createRuntime(room, [], {
    getRoom: async () => new Promise((resolve) => roomLookups.push(resolve)),
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const firstConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const secondConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (roomLookups.length < 2) await Promise.resolve();

  roomLookups[1]?.(room);
  const secondResult = await secondJoin;
  roomLookups[0]?.(room);
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(room.peers.get(OWNER_ID)?.transport.id, secondConnection.activeVoice?.transportId);
});

test('initial join is announced even when a reconnect replaces it during occupancy persistence', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const broadcasts: Broadcast[] = [];
  const occupancyTransitions: Settle[] = [];
  const runtime = createRuntime(room, broadcasts, {
    queueRoomOccupancyTransition: async () => new Promise((resolve) => occupancyTransitions.push(resolve)),
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const firstConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const secondConnection = fake<WsConnection>({ activeVoice: null, previewRoomIds: new Set() });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const firstJoin = runtime.joinVoiceRoom(firstConnection, { ...payload, name: 'First' }, null);
  while (occupancyTransitions.length < 1) await Promise.resolve();
  const secondJoin = runtime.joinVoiceRoom(secondConnection, { ...payload, name: 'Second' }, null);
  while (occupancyTransitions.length < 2) await Promise.resolve();

  occupancyTransitions[1]?.();
  const secondResult = await secondJoin;
  occupancyTransitions[0]?.();
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.deepEqual(
    broadcasts.map((message) => message.type),
    ['peer-joined']
  );
});

test('committed join still returns a correlated snapshot when occupancy persistence fails', async () => {
  const room: TestRoom = { id: ROOM_ID, name: 'Room', peers: new Map() };
  const sent: Array<{ type?: string; id?: string }> = [];
  const errors: LogRecord[] = [];
  const runtime = createRuntime(room, [], {
    logger: createCapturingLogger(errors),
    queueRoomOccupancyTransition: async () => {
      throw new Error('occupancy unavailable');
    },
    wsRegistry: {
      sendToConnection(_connection, envelope) {
        sent.push(envelope);
        return false;
      }
    },
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });

  try {
    const result = await runtime.joinVoiceRoom(
      createVoiceConnection(),
      { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN, name: 'Owner' },
      null,
      '',
      'recovery-request-1'
    );

    assert.equal(result.ok, true);
    assert.equal(room.peers.has(OWNER_ID), true);
    assert.equal(sent.at(-1)?.type, 'room.snapshot');
    assert.equal(sent.at(-1)?.id, 'recovery-request-1');
    assert.equal(
      errors.some((entry) => entry.evt === 'room.occupancy_persist_failed'),
      true
    );
  } finally {
    errors.length = 0;
  }
});

test('explicit leave cancels a join before it can attach a peer', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  let releaseIdentity = undefined as Settle | undefined;
  const runtime = createRuntime(room, [], {
    store: {
      async getOrCreatePeerIdentity() {
        return new Promise((resolve) => {
          releaseIdentity = resolve;
        });
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const join = runtime.joinVoiceRoom(connection, payload, null);
  while (!releaseIdentity) await Promise.resolve();
  await runtime.leaveVoiceRoom(connection, payload);
  releaseIdentity?.({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const result = await join;

  assert.equal(result.code, 'superseded_join');
  assert.equal(connection.activeVoice, null);
  assert.equal(room.peers.size, 0);
});

test('connection cleanup cancels a join before it can create a ghost peer', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  let releaseIdentity = undefined as Settle | undefined;
  const runtime = createRuntime(room, [], {
    store: {
      async getOrCreatePeerIdentity() {
        return new Promise((resolve) => {
          releaseIdentity = resolve;
        });
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });
  const payload = { roomId: ROOM_ID, peerId: OWNER_ID, sessionToken: OWNER_TOKEN };

  const join = runtime.joinVoiceRoom(connection, payload, null);
  while (!releaseIdentity) await Promise.resolve();
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseIdentity?.({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const result = await join;

  assert.equal(result.code, 'superseded_join');
  assert.equal(connection.activeVoice, null);
  assert.equal(room.peers.size, 0);
});

test('newer room join wins across different peer keys on one connection', async () => {
  const secondRoomId = 'room2';
  const secondPeerId = 'peer-owner2';
  const secondToken = 's'.repeat(32);
  const firstRoom = { id: ROOM_ID, peers: new Map() };
  const secondRoom = { id: secondRoomId, peers: new Map() };
  const rooms = new Map([
    [ROOM_ID, firstRoom],
    [secondRoomId, secondRoom]
  ]);
  let releaseFirstIdentity = undefined as Settle | undefined;
  const runtime = createRuntime(firstRoom, [], {
    presenceRooms: rooms,
    getRoom: async (roomId: string) => rooms.get(roomId) || null,
    store: {
      async getRoom(roomId: string) {
        return rooms.has(roomId) ? { id: roomId, name: roomId } : null;
      },
      async getOrCreatePeerIdentity({ roomId }: { roomId: string }) {
        if (roomId === ROOM_ID) {
          return new Promise((resolve) => {
            releaseFirstIdentity = resolve;
          });
        }
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });

  const firstJoin = runtime.joinVoiceRoom(
    connection,
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN
    },
    null
  );
  while (!releaseFirstIdentity) await Promise.resolve();
  const secondResult = await runtime.joinVoiceRoom(
    connection,
    {
      roomId: secondRoomId,
      peerId: secondPeerId,
      sessionToken: secondToken
    },
    null
  );
  releaseFirstIdentity?.({ status: 'ok', identity: { avatarColorKey: 'blue' } });
  const firstResult = await firstJoin;

  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.code, 'superseded_join');
  assert.equal(firstRoom.peers.size, 0);
  assert.equal(secondRoom.peers.get(secondPeerId).transport.id, connection.activeVoice?.transportId);
  assert.equal(connection.activeVoice?.roomId, secondRoomId);
});

test('same connection cannot leave an orphan when it changes peer id in one room', async () => {
  const secondPeerId = 'peer-owner2';
  const secondToken = 's'.repeat(32);
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const runtime = createRuntime(room, [], {
    closePeer: (roomId, peerId, transportId) => {
      const peer = roomId === ROOM_ID ? room.peers.get(peerId) : null;
      if (peer?.transport?.id === transportId) room.peers.delete(peerId);
    },
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async getOrCreatePeerIdentity() {
        return { status: 'ok', identity: { avatarColorKey: 'blue' } };
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });

  const firstResult = await runtime.joinVoiceRoom(
    connection,
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN
    },
    null
  );
  const secondResult = await runtime.joinVoiceRoom(
    connection,
    {
      roomId: ROOM_ID,
      peerId: secondPeerId,
      sessionToken: secondToken
    },
    null
  );

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual([...room.peers.keys()], [secondPeerId]);
  assert.equal(connection.activeVoice?.peerId, secondPeerId);
});

test('closed connection cannot subscribe after a delayed ban lookup', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const subscribers = new Set();
  let releaseBanLookup = undefined as Settle | undefined;
  const runtime = createRuntime(room, [], {
    findRoomBan: async () =>
      new Promise((resolve) => {
        releaseBanLookup = resolve;
      }),
    wsRegistry: {
      registerConnectionForRoom(connection) {
        subscribers.add(connection);
      },
      unregisterConnectionForRoom(connection) {
        subscribers.delete(connection);
      },
      unregisterConnectionFromAllRooms(connection) {
        subscribers.delete(connection);
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });

  const subscription = runtime.subscribePreview(connection, ROOM_ID);
  while (!releaseBanLookup) await Promise.resolve();
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseBanLookup?.(null);
  await subscription;

  assert.deepEqual([...connection.previewRoomIds], []);
  assert.equal(subscribers.has(connection), false);
});

test('closed connection rolls back preview subscription during snapshot build', async () => {
  const room: TestRoom = { id: ROOM_ID, peers: new Map() };
  const subscribers = new Set();
  const sentEnvelopes: Array<{ type?: string; id?: string }> = [];
  let releaseRoomLookup = undefined as Settle | undefined;
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return new Promise((resolve) => {
          releaseRoomLookup = resolve;
        });
      }
    },
    wsRegistry: {
      registerConnectionForRoom(connection) {
        subscribers.add(connection);
      },
      sendToConnection(_connection, envelope) {
        sentEnvelopes.push(envelope);
        return false;
      },
      unregisterConnectionForRoom(connection) {
        subscribers.delete(connection);
      },
      unregisterConnectionFromAllRooms(connection) {
        subscribers.delete(connection);
      }
    }
  });
  const connection = fake<WsConnection>({ activeVoice: null, closed: false, previewRoomIds: new Set() });

  const subscription = runtime.subscribePreview(connection, ROOM_ID);
  while (!releaseRoomLookup) await Promise.resolve();
  assert.equal(subscribers.has(connection), true);
  connection.closed = true;
  runtime.cleanupConnection(connection);
  releaseRoomLookup?.({ id: ROOM_ID, name: 'Room' });
  await subscription;

  assert.deepEqual([...connection.previewRoomIds], []);
  assert.equal(subscribers.has(connection), false);
  assert.deepEqual(sentEnvelopes, []);
});

test('unexpected disconnect preserves presence and a same-session replacement claims the lease', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const oldTransport = { id: 'transport-old', close() {} };
  const owner = createPeer(OWNER_ID, { transport: oldTransport, muted: true, screen: true });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  const oldConnection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: oldTransport.id
  });

  runtime.cleanupConnection(oldConnection);
  assert.equal(room.peers.get(OWNER_ID), owner);
  assert.equal(scheduler.size(), 1);
  assert.deepEqual(revoked, []);
  assert.deepEqual(closed, []);

  const replacement = createVoiceConnection();
  const result = await runtime.joinVoiceRoom(
    replacement,
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );

  assert.deepEqual(result, { ok: true, reconnecting: true });
  assert.equal(room.peers.size, 1);
  assert.equal(room.peers.get(OWNER_ID)?.muted, true);
  assert.equal(room.peers.get(OWNER_ID)?.screen, true);
  assert.notEqual(room.peers.get(OWNER_ID)?.transport.id, oldTransport.id);
  assert.equal(scheduler.size(), 0);

  scheduler.advance(1000);
  await Promise.resolve();
  assert.deepEqual(revoked, []);
  assert.deepEqual(closed, []);
});

test('lease expiry finalizes the exact disconnected transport once', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const removeCalls: unknown[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-expiring', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed, removeCalls });
  const connection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: owner.transport.id
  });

  runtime.cleanupConnection(connection);
  const [capturedExpiry] = scheduler.callbacks();
  scheduler.advance(999);
  assert.equal(room.peers.has(OWNER_ID), true);
  assert.deepEqual(revoked, []);

  scheduler.advance(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.peers.has(OWNER_ID), false);
  assert.equal(revoked.length, 1);
  assert.deepEqual(closed, [
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      transportId: 'transport-expiring',
      reason: 'lost'
    }
  ]);
  assert.deepEqual(removeCalls, [[ROOM_ID, OWNER_ID]]);

  capturedExpiry?.();
  await Promise.resolve();
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
});

test('retryable failure after replacement claim restores only the original remaining lease', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-retry', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  let rejectLookup = true;
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    getRoom: async () => {
      if (rejectLookup) throw new Error('storage unavailable');
      return room;
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );

  scheduler.advance(600);
  await assert.rejects(
    runtime.joinVoiceRoom(
      createVoiceConnection(),
      {
        roomId: ROOM_ID,
        peerId: OWNER_ID,
        sessionToken: OWNER_TOKEN,
        name: 'Owner'
      },
      null
    ),
    /storage unavailable/
  );
  assert.equal(scheduler.size(), 1);

  rejectLookup = false;
  scheduler.advance(399);
  assert.deepEqual(revoked, []);
  scheduler.advance(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
});

test('explicit leave terminal-claims a pending lease and stale expiry cannot finalize twice', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-left', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  const connection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: owner.transport.id
  });
  runtime.cleanupConnection(connection);
  const [capturedExpiry] = scheduler.callbacks();

  await runtime.finalizeReconnectLease({ roomId: ROOM_ID, peerId: OWNER_ID, reason: 'left' });
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.reason, 'left');

  capturedExpiry?.();
  scheduler.advance(1000);
  await Promise.resolve();
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
});

test('leave replayed on a fresh socket finalizes only the matching disconnected lease', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-replayed-leave', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );

  await runtime.leaveVoiceRoom(createVoiceConnection(), {
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN
  });

  assert.equal(room.peers.has(OWNER_ID), false);
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.reason, 'left');
});

test('terminal ownership invalidates an in-flight claimed replacement without resurrection', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let resolveIdentity = undefined as Settle | undefined;
  const identity = new Promise((resolve) => {
    resolveIdentity = resolve;
  });
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-claimed', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    store: {
      getOrCreatePeerIdentity: () => identity
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  const [capturedExpiry] = scheduler.callbacks();

  const replacement = runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  await new Promise((resolve) => setImmediate(resolve));
  await runtime.finalizeReconnectLease({ roomId: ROOM_ID, peerId: OWNER_ID, reason: 'banned' });
  resolveIdentity?.({ status: 'ok', identity: { id: 'identity-owner', avatarColorKey: 'blue' } });

  const result = await replacement;
  assert.equal(result.code, 'superseded_join');
  assert.equal(room.peers.has(OWNER_ID), false);
  assert.equal(revoked.length, 1);
  assert.equal(closed.length, 1);
  capturedExpiry?.();
  await Promise.resolve();
  assert.equal(revoked.length, 1);
});

test('replacement waits when expiry wins CAS before credential finalization', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let resolveRevoke = undefined as Settle | undefined;
  const revokeGate = new Promise((resolve) => {
    resolveRevoke = resolve;
  });
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-finalizing', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  let roomLookups = 0;
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    getRoom: async () => {
      roomLookups += 1;
      return room;
    },
    credentialBoundary: {
      async revokePeer(value) {
        revoked.push(value);
        await revokeGate;
        return { status: 'revoked' };
      }
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );

  scheduler.advance(1000);
  const replacement = runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  await Promise.resolve();
  assert.equal(revoked.length, 1);
  assert.equal(roomLookups, 0);

  resolveRevoke?.();
  const result = await replacement;
  assert.equal(result.ok, true);
  assert.equal(result.reconnecting, false);
  assert.equal(roomLookups, 1);
  assert.equal(closed.length, 1);
  assert.equal(room.peers.size, 1);
});

test('membership removal terminal-claims leases before one principal revoke and blocks stale session resurrection', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const principalRevokes = [];
  const removeCalls: unknown[] = [];
  let removedBeforeRevoke = -1;
  const owner = createPeer(OWNER_ID, {
    accountUserId: 'account-owner',
    transport: { id: 'transport-membership', close() {} }
  });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    removeCalls,
    credentialBoundary: {
      resolvePrincipal: () => ({ principalType: 'account', principalId: 'account-owner' }),
      async revokePrincipal(value) {
        principalRevokes.push(value);
        removedBeforeRevoke = removeCalls.length;
        return { status: 'revoked' };
      }
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  const [capturedExpiry] = scheduler.callbacks();

  const result = await runtime.disconnectAccountFromRoom({
    roomId: ROOM_ID,
    userId: 'account-owner',
    reason: 'membership-left'
  });
  assert.deepEqual(result, { ok: true, disconnected: 1 });
  assert.equal(principalRevokes.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(room.peers.has(OWNER_ID), false);
  // The credential dies before the LiveKit participant is removed, so the
  // client cannot reconnect in between.
  assert.equal(removedBeforeRevoke, 0);
  assert.equal(removeCalls.length, 1);

  capturedExpiry?.();
  const lateJoin = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    { id: 'account-owner' }
  );
  assert.equal(lateJoin.code, 'superseded_join');
  assert.equal(closed.length, 1);
  assert.equal(principalRevokes.length, 1);
});

test('stale superseded connection leave cannot evict the authoritative replacement', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-stale-leave', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  const staleConnection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: owner.transport.id
  });
  const replacement = createVoiceConnection();
  const joined = await runtime.joinVoiceRoom(
    replacement,
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  assert.equal(joined.ok, true);
  const replacementTransportId = room.peers.get(OWNER_ID)?.transport.id;

  await runtime.leaveVoiceRoom(staleConnection, staleConnection.activeVoice);
  assert.equal(room.peers.get(OWNER_ID)?.transport.id, replacementTransportId);
  assert.equal(replacement.activeVoice?.transportId, replacementTransportId);
  assert.deepEqual(revoked, []);
  assert.deepEqual(closed, []);
});

test('only one replacement may claim a pending reconnect lease', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let resolveIdentity = undefined as Settle | undefined;
  const identity = new Promise((resolve) => {
    resolveIdentity = resolve;
  });
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-single-claim', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    store: { getOrCreatePeerIdentity: () => identity }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );

  const first = runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  const second = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  assert.equal(second.code, 'superseded_join');

  resolveIdentity?.({ status: 'ok', identity: { id: 'identity-owner', avatarColorKey: 'blue' } });
  assert.equal((await first).ok, true);
  assert.equal(room.peers.size, 1);
  assert.deepEqual(revoked, []);
});

test('failed expiry finalizer blocks admission until credential revoke retry succeeds', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let attempts = 0;
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-revoke-retry', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    credentialBoundary: {
      async revokePeer(value) {
        revoked.push(value);
        attempts += 1;
        if (attempts <= 2) {
          throw Object.assign(new Error('credential unavailable'), { code: 'credential_unavailable' });
        }
        return { status: 'revoked' };
      }
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  scheduler.advance(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.peers.has(OWNER_ID), true);
  assert.equal(closed.length, 0);

  const blocked = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  assert.equal(blocked.code, 'reconnect_finalize_failed');
  assert.equal(room.peers.has(OWNER_ID), true);
  assert.equal(closed.length, 0);

  const result = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  assert.equal(result.ok, true);
  assert.equal(result.reconnecting, false);
  assert.equal(attempts, 3);
  assert.equal(closed.length, 1);
  assert.equal(room.peers.size, 1);
});

test('terminal prerequisite keeps ownership when the claimed transport disconnects again', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let releaseTerminal = undefined as Settle | undefined;
  let identityCalls = 0;
  const terminalPrerequisite = new Promise((resolve) => {
    releaseTerminal = resolve;
  });
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-terminal-prerequisite', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    store: {
      async getOrCreatePeerIdentity() {
        identityCalls += 1;
        return { status: 'ok', identity: { id: 'identity-owner', avatarColorKey: 'blue' } };
      }
    }
  });
  const connection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: owner.transport.id
  });

  const terminal = runtime.finalizeReconnectLease({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    reason: 'banned',
    finalizePeer: async () => {
      await terminalPrerequisite;
      return { finalized: false };
    }
  });
  runtime.cleanupConnection(connection);
  const replacement = runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(identityCalls, 0);

  releaseTerminal?.();
  await terminal;
  const result = await replacement;
  assert.equal(result.code, 'superseded_join');
  assert.equal(identityCalls, 0);
});

test('terminal scope retries a failed expiry finalizer and runs its queued callback', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let callbacks = 0;
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-failed-adoption', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    credentialBoundary: {
      async revokePeer() {
        throw new Error('expiry revoke failed');
      }
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  scheduler.advance(1000);
  await new Promise((resolve) => setImmediate(resolve));

  const result = await runtime.finalizeReconnectLease({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    reason: 'deleted',
    finalizePeer: async ({ peer }) => {
      callbacks += 1;
      if (peer) room.peers.delete(peer.id);
    }
  });
  assert.deepEqual(result, { ok: true, finalized: true });
  assert.equal(callbacks, 1);
  assert.equal(room.peers.has(OWNER_ID), false);
});

test('explicit leave only terminates the old generation and allows immediate same-session rejoin', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-explicit-rejoin', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  const connection = createVoiceConnection({
    roomId: ROOM_ID,
    peerId: OWNER_ID,
    sessionToken: OWNER_TOKEN,
    transportId: owner.transport.id
  });

  await runtime.leaveVoiceRoom(connection, connection.activeVoice);
  assert.equal(room.peers.has(OWNER_ID), false);
  const result = await runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  assert.equal(result.ok, true);
  assert.equal(result.reconnecting, false);
  assert.equal(room.peers.size, 1);
});

test('kick terminal ownership rejects same-session resurrection', async () => {
  for (const reason of ['kicked', 'room.kicked']) {
    const scheduler = createManualScheduler();
    const revoked: unknown[] = [];
    const closed: Closed[] = [];
    const owner = createPeer(OWNER_ID, { transport: { id: `transport-${reason}`, close() {} } });
    const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
    const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });

    await runtime.finalizeReconnectLease({ roomId: ROOM_ID, peerId: OWNER_ID, reason });
    const result = await runtime.joinVoiceRoom(
      createVoiceConnection(),
      {
        roomId: ROOM_ID,
        peerId: OWNER_ID,
        sessionToken: OWNER_TOKEN,
        name: 'Owner'
      },
      null
    );

    assert.equal(result.code, 'superseded_join', reason);
    assert.equal(room.peers.has(OWNER_ID), false, reason);
  }
});

test('membership finalizer failure does not close the peer or report successful disconnect', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const removeCalls: unknown[] = [];
  const owner = createPeer(OWNER_ID, {
    accountUserId: 'account-owner',
    transport: { id: 'transport-membership-failed', close() {} }
  });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    removeCalls,
    credentialBoundary: {
      resolvePrincipal: () => ({ principalType: 'account', principalId: 'account-owner' }),
      async revokePrincipal() {
        return { status: 'unavailable' };
      }
    }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );

  const result = await runtime.disconnectAccountFromRoom({
    roomId: ROOM_ID,
    userId: 'account-owner',
    reason: 'membership-left'
  });
  assert.deepEqual(result, { ok: false, code: 'unavailable', disconnected: 0 });
  assert.equal(room.peers.has(OWNER_ID), true);
  assert.deepEqual(closed, []);
  assert.deepEqual(removeCalls, []);
});

test('room terminal API claims every lease before custom delete finalizers run once', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-delete-owner', close() {} } });
  const viewer = createPeer(VIEWER_ID, { transport: { id: 'transport-delete-viewer', close() {} } });
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer]
    ])
  };
  const runtime = createLeaseRuntime({ room, scheduler, revoked, closed });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: VIEWER_ID,
      sessionToken: VIEWER_TOKEN,
      transportId: viewer.transport.id
    })
  );
  const capturedExpiries = scheduler.callbacks();
  const finalized: string[] = [];

  const result = await runtime.cancelRoomReconnectLeases({
    roomId: ROOM_ID,
    reason: 'deleted',
    finalizePeer: async ({ peer, ownershipFinalized }) => {
      assert.equal(ownershipFinalized, false);
      assert.ok(peer);
      finalized.push(peer.id);
      const current = room.peers.get(peer.id);
      if (current?.transport?.id === peer.transport.id) room.peers.delete(peer.id);
    }
  });

  assert.deepEqual(result, { ok: true, finalized: 2 });
  assert.deepEqual(finalized.sort(), [OWNER_ID, VIEWER_ID].sort());
  assert.deepEqual(revoked, []);
  assert.equal(room.peers.size, 0);
  for (const expiry of capturedExpiries) expiry();
  await Promise.resolve();
  assert.equal(finalized.length, 2);
});

test('claimed replacements are superseded by delete, kick, and membership terminal scopes', async () => {
  for (const scope of ['delete', 'kick', 'membership']) {
    const scheduler = createManualScheduler();
    const revoked: unknown[] = [];
    const closed: Closed[] = [];
    let resolveIdentity = undefined as Settle | undefined;
    const identity = new Promise((resolve) => {
      resolveIdentity = resolve;
    });
    const owner = createPeer(OWNER_ID, {
      accountUserId: 'account-owner',
      transport: { id: `transport-claimed-${scope}`, close() {} }
    });
    const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
    const runtime = createLeaseRuntime({
      room,
      scheduler,
      revoked,
      closed,
      store: { getOrCreatePeerIdentity: () => identity }
    });
    runtime.cleanupConnection(
      createVoiceConnection({
        roomId: ROOM_ID,
        peerId: OWNER_ID,
        sessionToken: OWNER_TOKEN,
        transportId: owner.transport.id
      })
    );
    const replacement = runtime.joinVoiceRoom(
      createVoiceConnection(),
      {
        roomId: ROOM_ID,
        peerId: OWNER_ID,
        sessionToken: OWNER_TOKEN,
        name: 'Owner'
      },
      { id: 'account-owner' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    if (scope === 'delete') {
      await runtime.cancelRoomReconnectLeases({ roomId: ROOM_ID, reason: 'deleted' });
    } else if (scope === 'membership') {
      await runtime.cancelAccountReconnectLeases({
        roomId: ROOM_ID,
        userId: 'account-owner',
        reason: 'membership-left'
      });
    } else {
      await runtime.finalizeReconnectLease({ roomId: ROOM_ID, peerId: OWNER_ID, reason: 'kicked' });
    }
    resolveIdentity?.({ status: 'ok', identity: { id: 'identity-owner', avatarColorKey: 'blue' } });
    const result = await replacement;
    assert.equal(result.code, 'superseded_join', scope);
    assert.equal(room.peers.has(OWNER_ID), false, scope);
    assert.equal(closed.length, 1, scope);
  }
});

test('terminal scope finalizes the current authoritative transport instead of an obsolete claimed record', async () => {
  const scheduler = createManualScheduler();
  const revoked: unknown[] = [];
  const closed: Closed[] = [];
  let resolveIdentity = undefined as Settle | undefined;
  const identity = new Promise((resolve) => {
    resolveIdentity = resolve;
  });
  const owner = createPeer(OWNER_ID, { transport: { id: 'transport-obsolete', close() {} } });
  const room = { id: ROOM_ID, peers: new Map([[owner.id, owner]]) };
  const runtime = createLeaseRuntime({
    room,
    scheduler,
    revoked,
    closed,
    store: { getOrCreatePeerIdentity: () => identity }
  });
  runtime.cleanupConnection(
    createVoiceConnection({
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      transportId: owner.transport.id
    })
  );
  const obsoleteJoin = runtime.joinVoiceRoom(
    createVoiceConnection(),
    {
      roomId: ROOM_ID,
      peerId: OWNER_ID,
      sessionToken: OWNER_TOKEN,
      name: 'Owner'
    },
    null
  );
  await new Promise((resolve) => setImmediate(resolve));

  room.peers.set(
    OWNER_ID,
    createPeer(OWNER_ID, {
      transport: { id: 'transport-authoritative', close() {} }
    })
  );
  await runtime.cancelRoomReconnectLeases({ roomId: ROOM_ID, reason: 'deleted' });
  resolveIdentity?.({ status: 'ok', identity: { id: 'identity-owner', avatarColorKey: 'blue' } });

  assert.equal((await obsoleteJoin).code, 'superseded_join');
  assert.equal(room.peers.has(OWNER_ID), false);
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.transportId, 'transport-authoritative');
});

test('snapshot reads presence after awaited message history', async () => {
  const owner = createPeer(OWNER_ID, { screen: true });
  const viewer = createPeer(VIEWER_ID, { viewedScreenPeerId: OWNER_ID });
  const room: TestRoom = {
    id: ROOM_ID,
    peers: new Map([
      [owner.id, owner],
      [viewer.id, viewer]
    ])
  };
  let releaseMessages = undefined as Settle | undefined;
  const messagesPending = new Promise((resolve) => {
    releaseMessages = resolve;
  });
  const runtime = createRuntime(room, [], {
    store: {
      async getRoom() {
        return { id: ROOM_ID, name: 'Room' };
      },
      async listMessages() {
        return messagesPending;
      }
    }
  });

  const snapshotPending = runtime.buildRoomSnapshot(ROOM_ID, 'active');
  await Promise.resolve();
  owner.screen = false;
  viewer.viewedScreenPeerId = '';
  releaseMessages?.([]);
  const snapshot = await snapshotPending;
  assert.ok(snapshot);

  assert.equal(snapshot.peers.find((peer) => peer.id === OWNER_ID).screen, false);
  assert.equal(snapshot.peers.find((peer) => peer.id === VIEWER_ID).viewedScreenPeerId, '');
});
