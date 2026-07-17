'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWsHandler } = require('../src/realtime/ws-handler');

const ROOM_ID = 'room1';
const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

class FakeSocket extends EventEmitter {
  close() {}
}

function createRegistry() {
  const registry = {
    connection: null,
    addGuestConnection(socket) {
      registry.connection = {
        activeVoice: null,
        closed: false,
        inboundMessageQueue: Promise.resolve(),
        previewRoomIds: new Set(),
        socket
      };
      return registry.connection;
    },
    rejectGuestOverLimit() { return false; },
    rejectOverLimit() { return false; },
    removeConnection(connection) { connection.closed = true; },
    sendReady() {},
    sendToConnection() {},
    touch() {}
  };
  return registry;
}

function clientFrame(type, payload) {
  return JSON.stringify({ type, payload });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for handler state');
}

function createHandler(resolveSessionUser, events, { failedJoinPeerId = '' } = {}) {
  const registry = createRegistry();
  const roomRuntime = {
    async joinVoiceRoom(connection, payload) {
      if (payload.peerId === failedJoinPeerId) throw new Error('synthetic join failure');
      events.push(`join:${payload.peerId}`);
      connection.activeVoice = {
        roomId: payload.roomId,
        peerId: payload.peerId,
        transportId: `transport:${payload.peerId}`
      };
      return { ok: true };
    },
    async leaveVoiceRoom(connection, payload) {
      events.push(`leave:${payload.peerId}`);
      if (
        connection.activeVoice?.roomId === payload.roomId
        && connection.activeVoice?.peerId === payload.peerId
      ) {
        connection.activeVoice = null;
      }
    },
    async sendAccountSummaries() {},
    subscribePreview() {},
    unsubscribePreview() {},
    updatePeerState: async () => ({ ok: true })
  };
  return {
    registry,
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
  const events = [];
  let sessionCall = 0;
  let releaseJoinSession;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    return new Promise((resolve) => { releaseJoinSession = resolve; });
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, {});

  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_A,
    sessionToken: TOKEN_A,
    name: 'Alice'
  }));
  await waitFor(() => Boolean(releaseJoinSession));
  socket.emit('message', clientFrame('room.leave', {
    roomId: ROOM_ID,
    peerId: PEER_A,
    sessionToken: TOKEN_A
  }));

  releaseJoinSession(null);
  await waitFor(() => events.length === 2);
  assert.deepEqual(events, [`join:${PEER_A}`, `leave:${PEER_A}`]);
  assert.equal(registry.connection.activeVoice, null);
});

test('two JOIN frames keep receive order when the first authorization is slower', async () => {
  const events = [];
  let sessionCall = 0;
  let releaseFirstJoinSession;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    if (sessionCall === 2) {
      return new Promise((resolve) => { releaseFirstJoinSession = resolve; });
    }
    return null;
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, {});

  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_A,
    sessionToken: TOKEN_A,
    name: 'Alice'
  }));
  await waitFor(() => Boolean(releaseFirstJoinSession));
  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_B,
    sessionToken: TOKEN_B,
    name: 'Bob'
  }));

  releaseFirstJoinSession(null);
  await waitFor(() => events.length === 2);
  assert.deepEqual(events, [`join:${PEER_A}`, `join:${PEER_B}`]);
  assert.equal(registry.connection.activeVoice.peerId, PEER_B);
});

test('queued room work is discarded after the connection closes', async () => {
  const events = [];
  let sessionCall = 0;
  let releaseJoinSession;
  const { handler, registry } = createHandler(async () => {
    sessionCall += 1;
    if (sessionCall === 1) return null;
    return new Promise((resolve) => { releaseJoinSession = resolve; });
  }, events);
  const socket = new FakeSocket();
  await handler.handleConnection(socket, {});

  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_A,
    sessionToken: TOKEN_A,
    name: 'Alice'
  }));
  await waitFor(() => Boolean(releaseJoinSession));
  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_B,
    sessionToken: TOKEN_B,
    name: 'Bob'
  }));
  socket.emit('close');
  releaseJoinSession(null);
  await registry.connection.inboundMessageQueue;

  assert.deepEqual(events, []);
  assert.equal(registry.connection.activeVoice, null);
});

test('one rejected handler does not poison the following queue tail', async (t) => {
  t.mock.method(console, 'error', () => {});
  const events = [];
  const { handler, registry } = createHandler(async () => null, events, {
    failedJoinPeerId: PEER_A
  });
  const socket = new FakeSocket();
  await handler.handleConnection(socket, {});

  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_A,
    sessionToken: TOKEN_A,
    name: 'Alice'
  }));
  socket.emit('message', clientFrame('room.join', {
    roomId: ROOM_ID,
    peerId: PEER_B,
    sessionToken: TOKEN_B,
    name: 'Bob'
  }));

  await waitFor(() => events.length === 1);
  assert.deepEqual(events, [`join:${PEER_B}`]);
  assert.equal(registry.connection.activeVoice.peerId, PEER_B);
});
