import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createWsHandler, type WsRoomRuntime } from '../src/realtime/ws-handler.ts';
import type { ConnectionRegistry, WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';

const ROOM_ID = 'room1';
const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

class FakeSocket extends EventEmitter {
  readyState = 1;
  send() {}
  close() {}
}

const REQUEST = fake<IncomingMessage>();

// What the handler did to the one connection it opened, and the runtime saw.
type Observed = {
  connection: WsConnection | null;
  lastJoinRequestId?: string;
  lastLeavePayload?: { sessionToken: string };
};

// The connection the handler opened.
function opened(observed: Observed) {
  assert.ok(observed.connection);
  return observed.connection;
}

function createRegistry(observed: Observed) {
  return fake<ConnectionRegistry>({
    addGuestConnection(socket) {
      const connection = fake<WsConnection>({
        activeVoice: null,
        closed: false,
        inboundMessageQueue: Promise.resolve(),
        previewRoomIds: new Set(),
        socket
      });
      observed.connection = connection;
      return connection;
    },
    rejectGuestOverLimit() {
      return false;
    },
    rejectOverLimit() {
      return false;
    },
    removeConnection(connection) {
      if (connection) connection.closed = true;
    },
    sendReady() {
      return true;
    },
    sendToConnection() {
      return true;
    },
    touch() {}
  });
}

function clientFrame(type: string, payload: Record<string, unknown>, id?: string) {
  return JSON.stringify(id ? { id, type, payload } : { type, payload });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for handler state');
}

function createHandler(
  resolveSessionUser: () => Promise<null>,
  events: string[],
  { failedJoinPeerId = '' }: { failedJoinPeerId?: string } = {}
) {
  const observed: Observed = { connection: null };
  const registry = createRegistry(observed);
  const roomRuntime = fake<WsRoomRuntime>({
    async joinVoiceRoom(connection, payload, _sessionUser, _clientIp, requestId) {
      if (payload.peerId === failedJoinPeerId) throw new Error('synthetic join failure');
      observed.lastJoinRequestId = requestId;
      events.push(`join:${payload.peerId}`);
      connection.activeVoice = {
        roomId: String(payload.roomId),
        peerId: String(payload.peerId),
        sessionToken: String(payload.sessionToken),
        transportId: `transport:${String(payload.peerId)}`
      };
      return { ok: true };
    },
    async leaveVoiceRoom(connection, payload) {
      observed.lastLeavePayload = payload;
      events.push(`leave:${payload.peerId}`);
      if (connection.activeVoice?.roomId === payload.roomId && connection.activeVoice?.peerId === payload.peerId) {
        connection.activeVoice = null;
      }
    },
    async sendAccountSummaries() {},
    async subscribePreview() {},
    unsubscribePreview() {},
    updatePeerState: async () => ({ ok: true })
  });
  return {
    registry: observed,
    handler: createWsHandler({
      registry,
      roomRuntime,
      resolveSessionUser,
      getFriendIds: async () => [],
      isUserOnline: () => false
    })
  };
}

test('JOIN then LEAVE keeps wire order while join authorization is pending', async () => {
  const events: string[] = [];
  let sessionCall = 0;
  let releaseJoinSession: ((value: null) => void) | undefined;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    return new Promise((resolve) => {
      releaseJoinSession = resolve;
    });
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, REQUEST);

  socket.emit(
    'message',
    clientFrame(
      'room.join',
      {
        roomId: ROOM_ID,
        peerId: PEER_A,
        sessionToken: TOKEN_A,
        name: 'Alice'
      },
      'recovery-request-1'
    )
  );
  await waitFor(() => Boolean(releaseJoinSession));
  socket.emit(
    'message',
    clientFrame('room.leave', {
      roomId: ROOM_ID,
      peerId: PEER_A,
      sessionToken: TOKEN_A
    })
  );

  releaseJoinSession?.(null);
  await waitFor(() => events.length === 2);
  assert.deepEqual(events, [`join:${PEER_A}`, `leave:${PEER_A}`]);
  assert.equal(opened(registry).activeVoice, null);
  assert.equal(registry.lastJoinRequestId, 'recovery-request-1');
  assert.equal(registry.lastLeavePayload?.sessionToken, TOKEN_A);
});

test('two JOIN frames keep receive order when the first authorization is slower', async () => {
  const events: string[] = [];
  let sessionCall = 0;
  let releaseFirstJoinSession: ((value: null) => void) | undefined;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    if (sessionCall === 2) {
      return new Promise((resolve) => {
        releaseFirstJoinSession = resolve;
      });
    }
    return null;
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, REQUEST);

  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      name: 'Alice'
    })
  );
  await waitFor(() => Boolean(releaseFirstJoinSession));
  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_B,
      sessionToken: TOKEN_B,
      name: 'Bob'
    })
  );

  releaseFirstJoinSession?.(null);
  await waitFor(() => events.length === 2);
  assert.deepEqual(events, [`join:${PEER_A}`, `join:${PEER_B}`]);
  assert.equal(opened(registry).activeVoice?.peerId, PEER_B);
});

test('queued room work is discarded after the connection closes', async () => {
  const events: string[] = [];
  let sessionCall = 0;
  let releaseJoinSession: ((value: null) => void) | undefined;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    return new Promise((resolve) => {
      releaseJoinSession = resolve;
    });
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, REQUEST);

  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      name: 'Alice'
    })
  );
  await waitFor(() => Boolean(releaseJoinSession));
  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_B,
      sessionToken: TOKEN_B,
      name: 'Bob'
    })
  );
  socket.emit('close');
  releaseJoinSession?.(null);
  await opened(registry).inboundMessageQueue;

  assert.deepEqual(events, []);
  assert.equal(opened(registry).activeVoice, null);
});

test('one rejected handler does not poison the following queue tail', async (t) => {
  t.mock.method(console, 'error', () => {});
  const events: string[] = [];
  const { handler, registry } = createHandler(async () => null, events, {
    failedJoinPeerId: PEER_A
  });
  const socket = new FakeSocket();
  await handler.handleConnection(socket, REQUEST);

  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      name: 'Alice'
    })
  );
  socket.emit(
    'message',
    clientFrame('room.join', {
      roomId: ROOM_ID,
      peerId: PEER_B,
      sessionToken: TOKEN_B,
      name: 'Bob'
    })
  );

  await waitFor(() => events.length === 1);
  assert.deepEqual(events, [`join:${PEER_B}`]);
  assert.equal(opened(registry).activeVoice?.peerId, PEER_B);
});
