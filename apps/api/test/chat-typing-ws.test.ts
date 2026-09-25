import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { SignedIn } from '@voice-room/shared/contracts/account';
import type { FriendRequests } from '@voice-room/shared/contracts/social';
import type { RoomCreated } from '@voice-room/shared/contracts/rooms';
import { createTestDatabase } from './db-harness.ts';
import {
  cookieFrom,
  request,
  socketDir,
  startServer as spawnServer,
  waitForHealthz,
  type ServerLogs
} from './fakes/server-process.ts';
import {
  countWsType,
  joinVoiceRoom,
  openWs,
  sendRawWs,
  sendWs,
  subscribeRoomPreview,
  waitForWsType,
  type WsSession
} from './ws-harness.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Account = { cookie: string; id: string };

async function startServer(t: TestContext) {
  const { dir, socketPath } = socketDir('voice-room-typing-');
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = spawnServer(socketPath, databaseUrl, logs, { AUTH_RATE_LIMIT: '0' });
  const sockets: WsSession[] = [];
  t.after(async () => {
    for (const session of sockets) session.ws.close();
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);

  return {
    async register(login: string) {
      const response = await request<SignedIn>(socketPath, {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
      });
      assert.equal(response.status, 201);
      return { cookie: cookieFrom(response.setCookie), id: response.body.user.id };
    },
    async befriend(requester: Account, addressee: Account, addresseeLogin: string) {
      const sent = await request(socketPath, {
        method: 'POST',
        pathname: '/api/friends/requests',
        cookie: requester.cookie,
        body: { login: addresseeLogin }
      });
      assert.ok(sent.status === 200 || sent.status === 201);
      const list = await request<FriendRequests>(socketPath, {
        pathname: '/api/friends/requests',
        cookie: addressee.cookie
      });
      const requestId = list.body.incoming[0]?.id;
      assert.ok(requestId);
      const accepted = await request(socketPath, {
        method: 'POST',
        pathname: `/api/friends/requests/${requestId}/accept`,
        cookie: addressee.cookie,
        body: {}
      });
      assert.equal(accepted.status, 200);
    },
    async createRoom(owner: Account) {
      const created = await request<RoomCreated>(socketPath, {
        method: 'POST',
        pathname: '/api/rooms',
        cookie: owner.cookie,
        body: { isStatic: true, name: 'Печатают' }
      });
      assert.equal(created.status, 201);
      return created.body.roomId;
    },
    async connect(cookie?: string) {
      const session = openWs(socketPath, cookie ? { cookie } : {});
      sockets.push(session);
      await session.ready;
      return session;
    }
  };
}

test('typing in a direct thread reaches only a friend, at most once a second', async (t) => {
  const server = await startServer(t);
  const alice = await server.register('alice');
  const bob = await server.register('bob');
  const carol = await server.register('carol');
  await server.befriend(alice, bob, 'bob');

  const aliceWs = await server.connect(alice.cookie);
  const bobWs = await server.connect(bob.cookie);
  const carolWs = await server.connect(carol.cookie);
  const guestWs = await server.connect();

  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  const notice = await waitForWsType(bobWs.frames, 'dm.typing');
  assert.deepEqual(notice.payload, { userId: alice.id, activity: 'typing' });

  // Repeats inside a second are dropped; strangers and guests reach nobody.
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(carolWs.ws, 'dm.typing', { userId: bob.id });
  sendWs(guestWs.ws, 'dm.typing', { userId: bob.id });
  await delay(400);
  assert.equal(countWsType(bobWs.frames, 'dm.typing'), 1);
  assert.equal(countWsType(aliceWs.frames, 'dm.typing'), 0, 'the sender is not told about their own typing');

  await delay(700);
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  await waitForWsType(bobWs.frames, 'dm.typing', () => countWsType(bobWs.frames, 'dm.typing') === 2);

  sendWs(aliceWs.ws, 'dm.typing', { userId: 'bob' });
  const rejected = await waitForWsType(aliceWs.frames, 'error');
  assert.equal(rejected.error.code, 'invalid_user_id');
});

test('room typing reaches everyone with the chat open, named by the server and never echoed', async (t) => {
  const server = await startServer(t);
  const owner = await server.register('roomowner');
  const viewer = await server.register('viewer');
  const outsider = await server.register('outsider');
  const roomId = await server.createRoom(owner);

  const ownerWs = await server.connect(owner.cookie);
  const viewerWs = await server.connect(viewer.cookie);
  const outsiderWs = await server.connect(outsider.cookie);
  const guestWs = await server.connect();
  await subscribeRoomPreview(ownerWs, roomId);
  await subscribeRoomPreview(viewerWs, roomId);
  await joinVoiceRoom(guestWs, {
    roomId,
    peerId: 'guest-typing-peer',
    sessionToken: 'g'.repeat(32),
    name: 'Гость Петя'
  });

  // A claimed name is ignored: the typist is the peer the server knows.
  sendRawWs(guestWs.ws, { type: 'room.chat.typing', payload: { roomId, name: 'Подделка' } });
  for (const session of [ownerWs, viewerWs]) {
    const notice = await waitForWsType(session.frames, 'room.chat.typing');
    assert.deepEqual(notice.payload, {
      roomId,
      typist: { peerId: 'guest-typing-peer', userId: null, name: 'Гость Петя' },
      activity: 'typing'
    });
  }

  sendWs(ownerWs.ws, 'room.chat.typing', { roomId });
  const fromOwner = await waitForWsType(guestWs.frames, 'room.chat.typing');
  assert.deepEqual(fromOwner.payload.typist, { peerId: `auth-${owner.id}`, userId: owner.id, name: 'roomowner' });
  await waitForWsType(viewerWs.frames, 'room.chat.typing', (frame) => frame.payload.typist.userId === owner.id);

  // Someone without the chat open cannot announce anything in it.
  sendWs(outsiderWs.ws, 'room.chat.typing', { roomId });
  await delay(400);
  assert.equal(countWsType(ownerWs.frames, 'room.chat.typing'), 1, 'only the guest reached the owner');
  assert.equal(countWsType(guestWs.frames, 'room.chat.typing'), 1, 'only the owner reached the guest');
  assert.equal(countWsType(viewerWs.frames, 'room.chat.typing'), 2);
  assert.equal(countWsType(outsiderWs.frames, 'room.chat.typing'), 0);
});

test('a notice says whether someone types or picks an emoji, and switching is not held back by the other one', async (t) => {
  const server = await startServer(t);
  const dana = await server.register('dana');
  const erik = await server.register('erik');
  await server.befriend(dana, erik, 'erik');
  const roomId = await server.createRoom(dana);

  const danaWs = await server.connect(dana.cookie);
  const erikWs = await server.connect(erik.cookie);

  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id, activity: 'emoji' });
  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id, activity: 'emoji' });
  sendWs(danaWs.ws, 'dm.typing', { userId: erik.id });
  await waitForWsType(erikWs.frames, 'dm.typing', () => countWsType(erikWs.frames, 'dm.typing') === 2);
  await delay(400);
  const direct = erikWs.frames.filter((frame) => frame.type === 'dm.typing').map((frame) => frame.payload);
  assert.deepEqual(
    direct,
    [
      { userId: dana.id, activity: 'emoji' },
      { userId: dana.id, activity: 'typing' }
    ],
    'a repeated emoji notice inside a second is dropped, the switch to typing arrives when the second is up'
  );

  sendRawWs(danaWs.ws, { type: 'dm.typing', payload: { userId: erik.id, activity: 'recording' } });
  const rejected = await waitForWsType(danaWs.frames, 'error');
  assert.equal(rejected.error.code, 'invalid_typing_activity');

  await subscribeRoomPreview(danaWs, roomId);
  await subscribeRoomPreview(erikWs, roomId);
  sendWs(erikWs.ws, 'room.chat.typing', { roomId, activity: 'emoji' });
  sendWs(erikWs.ws, 'room.chat.typing', { roomId, activity: 'typing' });
  await waitForWsType(danaWs.frames, 'room.chat.typing', () => countWsType(danaWs.frames, 'room.chat.typing') === 2);
  const inRoom = danaWs.frames
    .filter((frame) => frame.type === 'room.chat.typing')
    .map((frame) => frame.payload.activity);
  assert.deepEqual(inRoom, ['emoji', 'typing']);
});
