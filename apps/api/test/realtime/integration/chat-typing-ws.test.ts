import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import { FriendRequests } from '@voiceroom/shared/contracts/social';
import { PrivacyResponse, type PrivacySettings } from '@voiceroom/shared/contracts/privacy';
import { RoomCreated } from '@voiceroom/shared/contracts/rooms';
import { createTestDatabase } from '../../db-harness.ts';
import {
  cookieFrom,
  request,
  socketDir,
  startServer as spawnServer,
  waitForHealthz,
  type ServerLogs
} from '../../fakes/server-process.ts';
import {
  countWsType,
  joinVoiceRoom,
  openWs,
  sendRawWs,
  sendWs,
  subscribeRoomPreview,
  waitForWsType,
  type WsSession
} from '../../ws-harness.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Account = { cookie: string; id: string };

async function startServer(t: TestContext, env: Record<string, string> = {}) {
  const { dir, socketPath } = socketDir('voice-room-typing-');
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = spawnServer(socketPath, databaseUrl, logs, { AUTH_RATE_LIMIT: '0', ...env });
  const sockets: WsSession[] = [];
  t.after(async () => {
    for (const session of sockets) session.ws.close();
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);

  return {
    async send(from: Account, to: Account) {
      const response = await request(socketPath, {
        method: 'POST',
        pathname: `/api/dm/${to.id}`,
        cookie: from.cookie,
        body: { text: 'Hello' }
      });
      assert.equal(response.status, 201);
    },
    async privacy(account: Account, body: PrivacySettings) {
      const response = await request(
        socketPath,
        { method: 'PUT', pathname: '/api/privacy', cookie: account.cookie, body },
        PrivacyResponse
      );
      assert.equal(response.status, 200);
    },
    async block(owner: Account, peer: Account) {
      const response = await request(socketPath, {
        method: 'PUT',
        pathname: `/api/blocks/${peer.id}`,
        cookie: owner.cookie
      });
      assert.equal(response.status, 200);
    },
    async register(login: string) {
      const response = await request(
        socketPath,
        {
          method: 'POST',
          pathname: '/api/auth/register',
          body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
        },
        SignedIn
      );
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
      const list = await request(
        socketPath,
        {
          pathname: '/api/friends/requests',
          cookie: addressee.cookie
        },
        FriendRequests
      );
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
      const created = await request(
        socketPath,
        {
          method: 'POST',
          pathname: '/api/rooms',
          cookie: owner.cookie,
          body: { isStatic: true, name: 'Печатают' }
        },
        RoomCreated
      );
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

test('typing follows message privacy and forwards at most once a second', async (t) => {
  const server = await startServer(t);
  const alice = await server.register('alice');
  const bob = await server.register('bob');
  const carol = await server.register('carol');
  await server.befriend(alice, bob, 'bob');
  await server.privacy(bob, { messagesFrom: 'friends', callsFrom: 'friends' });

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

test('privacy broadcasts to the owner and privacy or block changes invalidate a cached typing permission', async (t) => {
  const server = await startServer(t);
  const alice = await server.register('alice');
  const bob = await server.register('bob');
  const aliceWs = await server.connect(alice.cookie);
  const bobWs = await server.connect(bob.cookie);
  const secondBobWs = await server.connect(bob.cookie);

  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  await waitForWsType(bobWs.frames, 'dm.typing');
  await server.privacy(bob, { messagesFrom: 'friends', callsFrom: 'friends' });
  for (const socket of [bobWs, secondBobWs]) {
    const changed = await waitForWsType(socket.frames, 'account.privacy.updated');
    assert.equal(changed.payload.privacy.messagesFrom, 'friends');
  }
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id, activity: 'emoji' });
  await delay(1100);
  assert.equal(countWsType(bobWs.frames, 'dm.typing'), 1);
  assert.equal(countWsType(aliceWs.frames, 'account.privacy.updated'), 0);

  await server.privacy(bob, { messagesFrom: 'everyone', callsFrom: 'friends' });
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id });
  await waitForWsType(bobWs.frames, 'dm.typing', () => countWsType(bobWs.frames, 'dm.typing') === 2);
  await server.block(bob, alice);
  sendWs(aliceWs.ws, 'dm.typing', { userId: bob.id, activity: 'emoji' });
  await delay(1100);
  assert.equal(countWsType(bobWs.frames, 'dm.typing'), 2);
});

test('the tenth new chat invalidates cached outgoing typing for an untouched pair', async (t) => {
  const server = await startServer(t, { MESSAGE_DIRECT_EMIT_ENABLED: 'false' });
  const [alice, untouched] = await Promise.all([server.register('alice'), server.register('untouched')]);
  const peers = await Promise.all(Array.from({ length: 10 }, (_, i) => server.register(`peer${i}`)));
  const tenth = peers[9];
  assert.ok(tenth);
  const [aliceWs, untouchedWs, tenthWs] = await Promise.all(
    [alice, untouched, tenth].map(({ cookie }) => server.connect(cookie))
  );
  assert.ok(aliceWs && untouchedWs && tenthWs);
  for (const peer of peers.slice(0, 9)) await server.send(alice, peer);
  sendWs(aliceWs.ws, 'dm.typing', { userId: untouched.id });
  await waitForWsType(untouchedWs.frames, 'dm.typing');
  await delay(1050);

  await server.send(alice, tenth);
  sendWs(aliceWs.ws, 'dm.typing', { userId: untouched.id, activity: 'emoji' });
  sendWs(aliceWs.ws, 'dm.typing', { userId: tenth.id });
  await waitForWsType(tenthWs.frames, 'dm.typing');
  await delay(200);
  assert.equal(countWsType(untouchedWs.frames, 'dm.typing'), 1);
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
