// What a client sends the moment its socket opens, while the server is still
// resolving the session behind it: nothing may be lost, and a socket that
// closes in that window must not stay registered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createWsHandler, type WsRoomRuntime } from '../src/realtime/ws-handler.ts';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import type { ResolvedSession } from '../src/app/context.ts';
import { Type, type Static } from 'typebox';
import { fake, storedUser } from './fakes/index.ts';
import { checked } from './helpers/checked.ts';

const Sent = Type.Object({ type: Type.String(), payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())) });
type Sent = Static<typeof Sent>;

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Sent[] = [];
  closeCode = 0;
  send(data: string) {
    this.sent.push(checked(Sent, JSON.parse(data), 'sent frame'));
  }
  close(code = 1005) {
    this.readyState = 3;
    this.closeCode = code;
  }
}

const LogRecord = Type.Object({ evt: Type.String() });

function setup() {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 10,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  const subscribed: string[] = [];
  let releaseSession!: (value: ResolvedSession) => void;
  const handler = createWsHandler({
    registry,
    roomRuntime: fake<WsRoomRuntime>({
      async sendAccountSummaries() {},
      async subscribePreview(_connection, roomId) {
        subscribed.push(roomId);
      }
    }),
    resolveSessionUser: () =>
      new Promise((resolve) => {
        releaseSession = resolve;
      }),
    getFriendIds: async () => [],
    isUserOnline: () => false
  });
  return { registry, handler, subscribed, release: () => releaseSession({ user: storedUser({ id: 'u1' }) }) };
}

const frame = (type: string, payload: Record<string, unknown>) => JSON.stringify({ type, payload });

test('frames sent while the session resolves are handled once the socket is ready', async () => {
  const { handler, subscribed, release } = setup();
  const socket = new FakeSocket();
  const opened = handler.handleConnection(socket, fake<IncomingMessage>());
  socket.emit('message', frame('ping', { at: 1 }));
  socket.emit('message', frame('room.preview.subscribe', { roomId: 'room1' }));
  release();
  await opened;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    socket.sent.map((sent) => sent.type),
    ['ready', 'pong']
  );
  assert.deepEqual(subscribed, ['room1']);
});

test('a socket that closes while the session resolves is never registered', async () => {
  const { handler, registry, release } = setup();
  const socket = new FakeSocket();
  const opened = handler.handleConnection(socket, fake<IncomingMessage>());
  socket.emit('close', 1006, '');
  release();
  await opened;

  assert.equal(registry.connectionCount('u1'), 0);
  assert.equal(registry.isUserOnline('u1'), false);
  assert.deepEqual(socket.sent, []);
});

test('a session lookup that fails closes the socket with 1011 instead of rejecting', async () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 10,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  const errors: unknown[] = [];
  const handler = createWsHandler({
    registry,
    roomRuntime: fake<WsRoomRuntime>({}),
    resolveSessionUser: async () => {
      throw new Error('timeout exceeded when trying to connect');
    },
    getFriendIds: async () => [],
    isUserOnline: () => false,
    logger: {
      info() {},
      warn() {},
      error(fields: unknown) {
        errors.push(fields);
      }
    }
  });
  const socket = new FakeSocket();

  // The route fires handleConnection with `void`: a rejection here is an
  // unhandled rejection, and Node ends the process on one.
  await assert.doesNotReject(handler.handleConnection(socket, fake<IncomingMessage>()));

  assert.equal(socket.closeCode, 1011);
  assert.deepEqual(socket.sent, []);
  assert.deepEqual(
    errors.map((fields) => checked(LogRecord, fields, 'log record').evt),
    ['ws.connect_failed']
  );
});
