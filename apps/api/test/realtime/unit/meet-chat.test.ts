import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { MEET_CHAT_MAX_BYTES, type ServerFrame } from '@voiceroom/shared/contracts/realtime';
import { parseServerFrame } from '@voiceroom/shared/realtime';
import type { RoomSurface } from '../../../src/domains/rooms/room-surface.policy.ts';
import { createMeetChat } from '../../../src/realtime/meet-chat.ts';
import { createConnectionRegistry, type WsConnection } from '../../../src/realtime/registry.ts';
import type { PresenceRoom } from '../../../src/realtime/room-presence.ts';
import { createWsHandler, type WsRoomRuntime } from '../../../src/realtime/ws-handler.ts';
import { fake } from '../../fakes/index.ts';

class TestSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  closeCode = 0;
  frames: ServerFrame[] = [];

  send(data: string) {
    const decoded = parseServerFrame(JSON.parse(data));
    assert.ok(decoded.ok);
    this.frames.push(decoded.frame);
  }

  close(code: number) {
    this.closeCode = code;
    this.readyState = 3;
    this.emit('close', code, '');
  }

  command(type: string, payload: object) {
    this.emit('message', JSON.stringify({ type, payload }));
  }

  get chat() {
    return this.frames.filter((frame) => frame.type === 'meet.chat.message').map((frame) => frame.payload);
  }

  get lastError() {
    return this.frames.findLast((frame) => frame.type === 'error')?.error.code;
  }
}

function setup(roomRuntime = fake<WsRoomRuntime>()) {
  const registry = createConnectionRegistry({ maxConnectionsPerUser: 10, keepaliveMs: 30_000 });
  const room: PresenceRoom = { id: 'meet-room', kind: 'meet', peers: new Map() };
  const rooms = new Map([[room.id, room]]);
  let now = 0;
  const meetChat = createMeetChat(rooms, registry, () => now);
  const logger = { info() {}, warn() {}, error() {} };

  async function open(surface: RoomSurface = 'meet') {
    const socket = new TestSocket();
    const handler = createWsHandler({ registry, roomRuntime, surface, meetChat, logger });
    await handler.handleConnection(socket, fake<IncomingMessage>());
    const connection = [...registry.allConnections()].find((candidate) => candidate.socket === socket);
    assert.ok(connection);
    return { socket, connection };
  }

  function attach(connection: WsConnection, peerId: string, target = room) {
    const transport = { id: connection.id, connection };
    connection.activeVoice = {
      roomId: target.id,
      peerId,
      sessionToken: 'x'.repeat(32),
      transportId: transport.id
    };
    target.peers.set(peerId, { id: peerId, name: peerId, gateGuestPrincipalId: `principal-${peerId}`, transport });
  }

  async function send({ socket, connection }: Awaited<ReturnType<typeof open>>, text: string) {
    socket.command('meet.chat.send', { text });
    await connection.inboundMessageQueue;
  }

  return { registry, room, rooms, open, attach, send, advanceWindow: () => (now += 10_000) };
}

test('Meet chat uses the current roster seat and excludes previews, other rooms and other surfaces', async () => {
  const { registry, rooms, room, open, attach, send } = setup();
  const alice = await open();
  attach(alice.connection, 'peer-alice');
  const bob = await open();
  attach(bob.connection, 'peer-bob');
  const other = await open();
  const otherRoom: PresenceRoom = { id: 'other-room', kind: 'meet', peers: new Map() };
  rooms.set(otherRoom.id, otherRoom);
  attach(other.connection, 'peer-other', otherRoom);
  const preview = await open();
  preview.connection.previewRoomIds.add(room.id);
  registry.registerConnectionForRoom(preview.connection, room.id);
  const main = await open('main');
  attach(main.connection, 'peer-main');
  const widget = await open('widget');
  attach(widget.connection, 'peer-widget');
  const replacement = await open();
  attach(replacement.connection, 'peer-alice');

  replacement.socket.command('meet.chat.send', {
    text: '  <b>literal</b>  ',
    roomId: otherRoom.id,
    authorId: 'spoofed',
    displayName: 'spoofed'
  });
  await replacement.connection.inboundMessageQueue;
  assert.deepEqual(bob.socket.chat, replacement.socket.chat);
  assert.equal(bob.socket.chat.length, 1);
  assert.deepEqual(bob.socket.chat[0], {
    id: bob.socket.chat[0]?.id,
    authorId: 'peer-alice',
    displayName: 'peer-alice',
    text: '<b>literal</b>'
  });

  for (const guest of [alice, preview, main, widget]) {
    await send(guest, 'refused');
    assert.equal(guest.socket.lastError, 'forbidden');
    assert.deepEqual(guest.socket.chat, []);
  }
  assert.deepEqual(other.socket.chat, []);
  const wrongRoom: PresenceRoom = { id: 'main-room', kind: 'main', peers: new Map() };
  rooms.set(wrongRoom.id, wrongRoom);
  attach(other.connection, 'peer-other', wrongRoom);
  await send(other, 'refused');
  assert.equal(other.socket.lastError, 'forbidden');
  assert.equal(bob.socket.chat.length, 1);
});

test('Meet chat refuses malformed, empty and oversized input and limits a guest principal across replacements', async () => {
  const { open, attach, send, advanceWindow } = setup();
  const first = await open();
  attach(first.connection, 'peer-alice');

  first.socket.command('meet.chat.send', { text: { body: 'invalid' } });
  assert.equal(first.socket.lastError, 'invalid_payload');
  for (const text of [' \n\t ', 'é'.repeat(MEET_CHAT_MAX_BYTES / 2 + 1), `${' '.repeat(MEET_CHAT_MAX_BYTES)}x`]) {
    await send(first, text);
    assert.equal(first.socket.lastError, 'invalid_request');
  }

  const maxText = 'é'.repeat(MEET_CHAT_MAX_BYTES / 2);
  for (let i = 0; i < 8; i++) await send(first, maxText);
  assert.equal(first.socket.chat.length, 8);
  assert.equal(first.socket.chat[0]?.text, maxText);
  first.socket.close(1000);

  const replacement = await open();
  attach(replacement.connection, 'peer-alice');
  await send(replacement, 'refused');
  assert.equal(replacement.socket.lastError, 'rate_limited');
  assert.equal(replacement.socket.chat.length, 0);
  advanceWindow();
  await send(replacement, 'after window');
  assert.deepEqual(
    replacement.socket.chat.map((message) => message.text),
    ['after window']
  );
});

test('Meet chat has a shared room budget and drops delivery to a backed-up socket without replay', async () => {
  const { open, attach, send, advanceWindow } = setup();
  const slow = await open();
  attach(slow.connection, 'peer-slow');
  slow.socket.bufferedAmount = 64 * 1024 - 8;
  for (let i = 0; i < 5; i++) {
    const sender = await open();
    attach(sender.connection, `peer-sender-${i}`);
    for (let j = 0; j < 8; j++) await send(sender, 'fills the room budget');
    assert.equal(sender.socket.chat.length, 8);
  }
  const next = await open();
  attach(next.connection, 'peer-next');
  await send(next, 'over budget');
  assert.equal(next.socket.lastError, 'rate_limited');
  assert.equal(slow.socket.chat.length, 0);
  slow.socket.bufferedAmount = 0;
  advanceWindow();
  await send(next, 'fresh only');
  assert.deepEqual(
    slow.socket.chat.map((message) => message.text),
    ['fresh only']
  );
});

test('a Meet socket cannot accumulate pending chat while its join is waiting', async () => {
  let releaseJoin!: () => void;
  const joining = new Promise<void>((resolve) => (releaseJoin = resolve));
  const { open } = setup(
    fake<WsRoomRuntime>({
      async joinVoiceRoom() {
        await joining;
        return { ok: true, reconnecting: false };
      }
    })
  );
  const { socket, connection } = await open();
  socket.command('room.join', {
    roomId: 'meet-room',
    peerId: 'peer-alice',
    sessionToken: 'x'.repeat(32),
    name: 'Alice'
  });
  await Promise.resolve();
  for (let i = 0; i < 64; i++) socket.command('meet.chat.send', { text: 'queued' });
  assert.equal(socket.closeCode, 1008);
  releaseJoin();
  await connection.inboundMessageQueue;
  assert.deepEqual(socket.chat, []);
});

test('a normal Meet close handshake still processes the leave frame sent before it', async () => {
  let left = false;
  const { open, attach } = setup(
    fake<WsRoomRuntime>({
      async leaveVoiceRoom() {
        left = true;
      }
    })
  );
  const { socket, connection } = await open();
  attach(connection, 'peer-alice');
  socket.command('room.leave', { roomId: 'meet-room', peerId: 'peer-alice', sessionToken: 'x'.repeat(32) });
  socket.readyState = 2;
  await connection.inboundMessageQueue;
  assert.equal(left, true);
});
