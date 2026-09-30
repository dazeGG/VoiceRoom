process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.ROOM_CHAT_RATE_LIMIT = '0';

import test from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { RoomChat, RoomMessageAnswer } from '@voice-room/shared/contracts/messages';
import type { RoomCreated, RoomStatus } from '@voice-room/shared/contracts/rooms';
import { dbRoom, fake, type DbRoom, type Fakes } from './fakes/index.ts';
import type { ApiBody } from './fakes/server-process.ts';

const { createApiServer } = await import('../src/server.ts');
const { createApiRuntime } = await import('../src/app/api-runtime.ts');
const { openWs, joinVoiceRoom, sendWs, waitForWsType } = await import('./ws-harness.ts');

// A logger that records the structured fields, so a test can assert the API
// observed a failure instead of swallowing it: Fastify's own logger is silent
// under the test environment.
type LogRecord = Record<string, unknown> & { level: string; msg?: string };

function createCapturingLogger(records: LogRecord[]): FastifyBaseLogger {
  const record = (level: string) => (fields: object, msg?: string) => {
    records.push({ level, ...fields, msg });
  };
  const logger: FastifyBaseLogger = fake<FastifyBaseLogger>({
    level: 'trace',
    debug: record('debug'),
    error: record('error'),
    fatal: record('fatal'),
    info: record('info'),
    trace: record('trace'),
    warn: record('warn'),
    silent: () => {},
    child: () => logger
  });
  return logger;
}

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createFakeStore() {
  const rooms = new Map<string, DbRoom>();
  const messages = new Map<string, Array<Record<string, unknown>>>();
  const createRoom = async ({
    creatorIp = '',
    isStatic = false,
    roomId = '',
    name = '',
    now = Date.now()
  }: { creatorIp?: unknown; isStatic?: boolean; roomId?: string; name?: unknown; now?: number } = {}) => {
    const room = dbRoom(roomId, {
      createdAt: now,
      creatorIp: String(creatorIp),
      emptySince: now,
      isStatic,
      name: String(name),
      updatedAt: now
    });
    rooms.set(roomId, room);
    return { ...room, peers: new Map() };
  };
  return {
    rooms,
    async appendMessage(roomId, message) {
      if (!rooms.has(roomId)) return null;
      const entry = { ...message, roomId };
      const list = messages.get(roomId) || [];
      list.push(entry);
      messages.set(roomId, list);
      return entry;
    },
    async countQuotaRoomsForIp() {
      return 0;
    },
    async countRooms() {
      return rooms.size;
    },
    createRoom,
    async createRoomWithQuota(options) {
      const room = await createRoom(options);
      return { room, status: 'created' };
    },
    async getRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? { ...room, peers: new Map() } : null;
    },
    async getOrCreatePeerIdentity({ peerId, sessionToken } = { roomId: '', peerId: '', sessionToken: '' }) {
      if (typeof sessionToken === 'string' && sessionToken.startsWith('bad')) {
        return { identity: null, status: 'token_mismatch' };
      }
      return { identity: { avatarColorKey: 'blurple', peerId }, status: 'created' };
    },
    normalizeGatePrincipal({
      accountUserId,
      guestPrincipalId
    }: { accountUserId?: string | null; guestPrincipalId?: string } = {}) {
      return accountUserId
        ? { principalId: accountUserId, principalType: 'account' as const }
        : { principalId: guestPrincipalId || 'test-guest', principalType: 'guest' as const };
    },
    async isRoomServerMuted() {
      return false;
    },
    async listMessages(roomId) {
      return messages.get(roomId) || [];
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    async markRoomActive(_roomOrId?: unknown): Promise<unknown> {
      return null;
    },
    async markRoomEmpty(_roomOrId?: unknown): Promise<unknown> {
      return null;
    },
    async pruneRooms(): Promise<unknown> {
      return false;
    }
  } satisfies Fakes['store'] & { rooms: Map<string, DbRoom> };
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function request<Body = ApiBody>(
  port: number,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {}
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, json: (await response.json()) as Body & ApiBody };
}

test('server create/chat handlers use async store and reject anonymous link-only chat', async () => {
  const store = createFakeStore();
  const server = createApiServer({ store });
  const port = await listen(server);
  try {
    const created = await request<RoomCreated>(port, '/api/rooms', { method: 'POST', body: { isStatic: false } });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.isStatic, false);

    const posted = await request(port, `/api/rooms/${created.json.roomId}/chat`, {
      method: 'POST',
      body: { name: 'Link user', text: 'hello from link' }
    });
    assert.equal(posted.response.status, 403);
    assert.equal(posted.json.error, 'Active room presence or login required');

    const listed = await request<RoomChat>(port, `/api/rooms/${created.json.roomId}/chat`);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.json.messages.length, 0);
  } finally {
    await close(server);
  }
});

test('server preserves active voice peer spoof protection and rejects anonymous link-only chat', async () => {
  const store = createFakeStore();
  const room = await store.createRoom({ creatorIp: 'test', isStatic: true, roomId: 'room1', now: Date.now() });
  assert.equal(room.id, 'room1');
  const server = createApiServer({ store });
  const port = await listen(server);
  const voice = openWs(port);
  await voice.ready;
  await joinVoiceRoom(voice, {
    roomId: 'room1',
    peerId: 'peer0001',
    sessionToken: 'goodtoken12345678901234567890123',
    name: 'Ada'
  });

  try {
    const activePost = await request<RoomMessageAnswer>(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { peerId: 'peer0001', sessionToken: 'goodtoken12345678901234567890123', name: 'Ada', text: 'from voice' }
    });
    assert.equal(activePost.response.status, 201);
    assert.equal(activePost.json.message.avatarColorKey, 'blurple');

    const spoof = await request(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { peerId: 'peer0001', sessionToken: 'badtoken123456789012345678901234', name: 'Mallory', text: 'spoof' }
    });
    assert.equal(spoof.response.status, 403);

    const linkOnly = await request(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { name: 'Link user', text: 'allowed' }
    });
    assert.equal(linkOnly.response.status, 403);
    assert.equal(linkOnly.json.error, 'Active room presence or login required');
  } finally {
    voice.ws.close();
    await close(server);
  }
});

test('server logs mark-empty failures instead of creating unhandled rejections', async () => {
  const store = createFakeStore();
  const room = await store.createRoom({
    creatorIp: 'test',
    isStatic: false,
    roomId: 'room-empty-fail',
    now: Date.now()
  });
  assert.equal(room.id, 'room-empty-fail');
  store.markRoomEmpty = async () => {
    throw new Error('db offline');
  };

  const errors: LogRecord[] = [];
  const server = createApiServer({ store, logger: createCapturingLogger(errors) });
  const port = await listen(server);
  const voice = openWs(port);
  await voice.ready;
  await joinVoiceRoom(voice, {
    roomId: 'room-empty-fail',
    peerId: 'peer0002',
    sessionToken: 'goodtoken12345678901234567890123',
    name: 'Ada'
  });

  try {
    sendWs(voice.ws, 'room.leave', {
      roomId: 'room-empty-fail',
      peerId: 'peer0002',
      sessionToken: 'goodtoken12345678901234567890123'
    });
    const persistFailed = () => errors.some((entry) => entry.evt === 'room.occupancy_persist_failed');
    for (let attempt = 0; attempt < 50 && !persistFailed(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(persistFailed(), true);
  } finally {
    voice.ws.close();
    await close(server);
  }
});

test('server serializes a late empty write before the active write of a concurrent join', async () => {
  const store = createFakeStore();
  await store.createRoom({ creatorIp: 'test', isStatic: false, roomId: 'room-occupancy-race', now: Date.now() });

  const identityStarted = deferred();
  const releaseIdentity = deferred();
  const emptyStarted = deferred();
  const releaseEmpty = deferred();
  const originalGetOrCreatePeerIdentity = store.getOrCreatePeerIdentity.bind(store);
  store.getOrCreatePeerIdentity = async (input) => {
    if (input?.peerId === 'joining-peer') {
      identityStarted.resolve();
      await releaseIdentity.promise;
    }
    return originalGetOrCreatePeerIdentity(input);
  };

  const writes: string[] = [];
  store.markRoomActive = async () => {
    writes.push('active');
  };
  store.markRoomEmpty = async () => {
    writes.push('empty:start');
    emptyStarted.resolve();
    await releaseEmpty.promise;
    writes.push('empty:end');
  };

  const server = createApiServer({ store });
  const port = await listen(server);
  const leaving = openWs(port);
  const joining = openWs(port);
  await Promise.all([leaving.ready, joining.ready]);
  await joinVoiceRoom(leaving, {
    roomId: 'room-occupancy-race',
    peerId: 'leaving-peer',
    sessionToken: 'l'.repeat(32),
    name: 'Leaving'
  });
  writes.length = 0;

  try {
    sendWs(joining.ws, 'room.join', {
      roomId: 'room-occupancy-race',
      peerId: 'joining-peer',
      sessionToken: 'j'.repeat(32),
      name: 'Joining'
    });
    await identityStarted.promise;

    sendWs(leaving.ws, 'room.leave', {
      roomId: 'room-occupancy-race',
      peerId: 'leaving-peer',
      sessionToken: 'l'.repeat(32)
    });
    await emptyStarted.promise;
    releaseIdentity.resolve();

    const deadline = Date.now() + 5000;
    while (true) {
      const status = await request<RoomStatus>(port, '/api/rooms/room-occupancy-race');
      if (status.json.peers === 1) break;
      if (Date.now() >= deadline) throw new Error('joining peer was not installed while empty write was pending');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    releaseEmpty.resolve();
    await waitForWsType(joining.frames, 'room.snapshot', (frame) => frame.payload?.roomId === 'room-occupancy-race');
    assert.deepEqual(writes, ['empty:start', 'empty:end', 'active']);
  } finally {
    releaseIdentity.resolve();
    releaseEmpty.resolve();
    leaving.ws.close();
    joining.ws.close();
    await close(server);
  }
});

test('pruning retries failed active occupancy before sweeping dynamic rooms', async () => {
  const store = createFakeStore();
  const roomId = 'room-active-retry';
  await store.createRoom({ creatorIp: 'test', isStatic: false, roomId, now: 1000 });
  let activeAttempts = 0;
  store.markRoomActive = async (activeRoomId?: unknown) => {
    activeAttempts += 1;
    if (activeAttempts === 1) throw new Error('temporary occupancy failure');
    const room = store.rooms.get(String(activeRoomId));
    if (room) room.emptySince = null;
  };
  store.pruneRooms = async () => {
    const room = store.rooms.get(roomId);
    if (room?.emptySince != null) store.rooms.delete(roomId);
  };

  const errors: LogRecord[] = [];
  const runtime = createApiRuntime();
  const server = runtime.createServer({ store, logger: createCapturingLogger(errors) });
  const port = await listen(server);
  const voice = openWs(port);
  await voice.ready;

  try {
    await joinVoiceRoom(voice, {
      roomId,
      peerId: 'active-peer',
      sessionToken: 'a'.repeat(32),
      name: 'Active peer'
    });

    assert.equal(activeAttempts, 1);
    assert.ok(await store.getRoom(roomId));

    await runtime.pruneRooms(5000);

    assert.equal(activeAttempts, 2);
    assert.equal((await store.getRoom(roomId))?.emptySince, null);
    assert.ok(await store.getRoom(roomId));
    assert.equal(
      errors.some((entry) => entry.evt === 'room.occupancy_persist_failed'),
      true
    );
  } finally {
    voice.ws.close();
    await close(server);
  }
});
