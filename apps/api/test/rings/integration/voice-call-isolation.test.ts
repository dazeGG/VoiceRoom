import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { Me, SignedIn } from '@voiceroom/shared/contracts/account';
import { AccountDetail, LiveRooms, RoomCalls, RoomHistory } from '@voiceroom/shared/contracts/admin';
import { CallBootstrap } from '@voiceroom/shared/contracts/rings';
import { RoomList } from '@voiceroom/shared/contracts/rooms';
import { createApiRuntime } from '../../../src/app/api-runtime.ts';
import { createPersonalRuntime } from '../../../src/app/personal-runtime.ts';
import { createRoomStore } from '../../../src/app/room-store.ts';
import { createLogger } from '../../../src/lib/logger.ts';
import { hashPassword } from '../../../src/lib/password.ts';
import type { ApiServer } from '../../../src/platform/http/http-server.ts';
import { createRoomSummaries } from '../../../src/realtime/room-summaries.ts';
import type { PresenceRoom, RosterPeer } from '../../../src/realtime/room-presence.ts';
import { createVoiceStays } from '../../../src/realtime/voice-stays.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { dbRoom, fake, recordingLogger, userSession } from '../../fakes/index.ts';
import { createFullTestRuntime, runtimeDeps } from '../../fakes/room-runtime.ts';
import { cookieFrom, registerAccount, request, socketDir } from '../../fakes/server-process.ts';
import { seedVoiceCall } from '../../fixtures/voice-call.ts';
import { staffCookie } from '../../staff-session.ts';
import { countWsType, openWs, sendRawWs, waitForWsType, type WsSession } from '../../ws-harness.ts';

const adminId = '00000000-0000-4000-8000-0000000000ad';

function listen(server: ApiServer, socketPath: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
}

test('private call rooms stay hidden from room, socket, token and staff endpoints', async (t) => {
  const { pool, databaseUrl, cleanup } = await createTestDatabase(t);
  const full = socketDir('voice-call-full-');
  const meet = socketDir('voice-call-meet-');
  const logger = createLogger({ name: 'api' });
  const env = {
    NODE_ENV: 'test',
    WIDGET_ENABLED: 'true',
    VOICE_CALLS_ENABLED: 'true',
    PLATFORM_ADMIN_USER_IDS: adminId,
    PERSONAL_ORIGIN: 'https://meet.example.test'
  };
  const runtime = createApiRuntime({ env });
  runtime.services.connect({ databaseUrl, logger });
  const personal = createPersonalRuntime({ env, databaseUrl, logger });
  const store = createRoomStore({ pool });
  const roster = new Map<string, RosterPeer>();
  const server = runtime.createServer({
    store: {
      ...store,
      async getRoom(roomId) {
        const room = await store.getRoom(roomId);
        return room?.kind === 'call' ? { ...room, peers: roster } : room;
      }
    }
  });
  const meetServer = personal.createServer();
  const sockets: WsSession[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.ws.terminate();
    await Promise.all([server.app.close(), meetServer.app.close()]);
    await Promise.all([runtime.closeStores(logger), personal.closeStores()]);
    await cleanup();
    await Promise.all([full.dir, meet.dir].map((dir) => fs.rm(dir, { force: true, recursive: true })));
  });
  await pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true');
  await Promise.all([listen(server, full.socketPath), listen(meetServer, meet.socketPath)]);

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    adminId,
    await hashPassword('password123')
  ]);
  const signedIn = await request(
    full.socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'root', password: 'password123' }
    },
    SignedIn
  );
  const staff = await staffCookie(full.socketPath, cookieFrom(signedIn.setCookie));
  assert.ok(staff);
  const alice = await registerAccount(full.socketPath, 'alice');
  const bob = await registerAccount(full.socketPath, 'bob');
  const accountId = async (cookie: string) => {
    const account = (await request(full.socketPath, { pathname: '/api/auth/me', cookie }, Me)).body.user;
    assert.ok(account);
    return account.id;
  };
  const [aliceId, bobId] = await Promise.all([accountId(alice), accountId(bob)]);
  const { room, callId } = await seedVoiceCall(pool, aliceId, bobId);
  const startedAt = Date.now() - 180_000;
  roster.set('alice-call-peer', { id: 'alice-call-peer', accountUserId: aliceId, name: 'Alice', joinedAt: startedAt });
  roster.set('bob-call-peer', { id: 'bob-call-peer', accountUserId: bobId, name: 'Bob', joinedAt: startedAt });
  await store.createRoomWithQuota({ roomId: 'ordinary', ownerId: aliceId, isStatic: true });
  const ordinaryVoice = { roomId: 'ordinary', peerId: 'alice-test-peer', sessionToken: 's'.repeat(32), name: 'Alice' };
  const callVoice = { ...ordinaryVoice, roomId: room.id };

  const list = await request(full.socketPath, { pathname: '/api/auth/rooms', cookie: alice }, RoomList);
  assert.deepEqual(
    list.body.rooms.map(({ roomId }) => roomId),
    ['ordinary']
  );
  for (const [socketPath, pathname] of [
    [full.socketPath, `/api/rooms/${room.id}`],
    [full.socketPath, `/api/rooms/${room.id}/peers`],
    [full.socketPath, `/api/rooms/${room.id}/chat`],
    [full.socketPath, `/api/widget/rooms/${room.id}`],
    [meet.socketPath, `/api/meet/rooms/${room.id}/status`]
  ] as const) {
    assert.equal((await request(socketPath, { pathname })).status, 404, pathname);
  }
  const bookmark = await request(full.socketPath, {
    method: 'POST',
    pathname: '/api/auth/rooms',
    cookie: alice,
    body: { roomId: room.id }
  });
  assert.equal(bookmark.status, 404);
  const members = await request(full.socketPath, { pathname: `/api/rooms/${room.id}/members`, cookie: alice });
  assert.equal(members.body.code, 'membership_required');
  const mute = await request(full.socketPath, {
    method: 'PUT',
    pathname: `/api/notifications/room/${room.id}/mute`,
    cookie: alice,
    body: { muted: true }
  });
  assert.equal(mute.status, 404);
  const legacyRing = await request(full.socketPath, { pathname: `/api/rings/${callId}`, cookie: alice });
  assert.equal(legacyRing.status, 404);

  const bootstrapPath = '/api/call-rings';
  const anonymous = await request(full.socketPath, { pathname: bootstrapPath });
  assert.equal(anonymous.status, 401);
  const bootstrap = await request(full.socketPath, { pathname: bootstrapPath, cookie: bob }, CallBootstrap);
  assert.equal(bootstrap.headers['cache-control'], 'no-store');
  assert.deepEqual(bootstrap.body, {
    ok: true,
    enabled: true,
    activeCalls: [],
    incoming: [],
    missed: [],
    serverNow: bootstrap.body.serverNow
  });
  assert.equal(
    (await request(full.socketPath, { method: 'POST', pathname: bootstrapPath, cookie: alice, body: {} })).status,
    400
  );

  for (const [socketPath, pathname, path, cookie] of [
    [full.socketPath, '/api/livekit-token', '/api/ws', alice],
    [full.socketPath, '/api/widget/livekit-token', '/api/widget/ws', undefined],
    [meet.socketPath, '/api/meet/livekit-token', '/api/meet/ws', undefined]
  ] as const) {
    const token = await request(socketPath, { method: 'POST', pathname, cookie, body: callVoice });
    assert.equal(token.body.code, 'room_not_found', pathname);
    const connection = openWs(socketPath, { path, cookie });
    sockets.push(connection);
    await connection.ready;
    sendRawWs(connection.ws, { id: 'join-call', type: 'room.join', payload: callVoice });
    assert.equal(
      (await waitForWsType(connection.frames, 'error', ({ id }) => id === 'join-call')).error.code,
      'room_not_found'
    );
    assert.equal(countWsType(connection.frames, 'room.snapshot'), 0);
    if (path === '/api/ws') {
      sendRawWs(connection.ws, { id: 'preview-call', type: 'room.preview.subscribe', payload: { roomId: room.id } });
      assert.equal(
        (await waitForWsType(connection.frames, 'error', ({ id }) => id === 'preview-call')).error.code,
        'room_not_found'
      );
      await waitForWsType(connection.frames, 'room.summary', ({ payload }) => payload.room.roomId === 'ordinary');
      assert.equal(countWsType(connection.frames, 'room.summary'), 1);
    }
  }

  // Even an old untyped stay that references a call room is excluded by staff reads.
  const {
    rows: [oldStay]
  } = await pool.query<{ id: string }>(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
       VALUES ($1, $2, now() - interval '2 minutes', now()) RETURNING id`,
    [room.id, aliceId]
  );
  assert.ok(oldStay);
  const adminLive = await request(full.socketPath, { pathname: '/api/admin/rooms', cookie: staff }, LiveRooms);
  assert.deepEqual(adminLive.body.rooms, []);
  const history = await request(full.socketPath, { pathname: '/api/admin/rooms/history', cookie: staff }, RoomHistory);
  assert.deepEqual(history.body.stays, []);
  const calls = await request(full.socketPath, { pathname: '/api/admin/rooms/calls', cookie: staff }, RoomCalls);
  assert.deepEqual(calls.body.calls, []);
  for (const pathname of [`/api/admin/rooms/live/${room.id}`, `/api/admin/rooms/calls/${oldStay.id}`]) {
    assert.equal((await request(full.socketPath, { pathname, cookie: staff })).status, 404);
  }
  const staffAccount = await request(
    full.socketPath,
    { pathname: `/api/admin/accounts/${aliceId}`, cookie: staff },
    AccountDetail
  );
  assert.ok(staffAccount.body.days.every(({ voiceMinutes }) => voiceMinutes === 0));
});

test('the call bootstrap defaults to disabled', async (t) => {
  const app = createApiRuntime({ env: { NODE_ENV: 'test' } }).createApp({
    users: { getSessionUser: async () => userSession() }
  });
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/call-rings', headers: { cookie: 'vr_session=test-session' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json<CallBootstrap>().enabled, false);
});

test('summary creation and voice stay recording skip calls even with an occupied roster', async () => {
  const room = dbRoom('private', { kind: 'call', isStatic: false });
  const peer = { id: 'private-peer', accountUserId: 'alice', joinedAt: 10 };
  const privatePresence: PresenceRoom = { id: room.id, kind: 'call', peers: new Map([[peer.id, peer]]) };
  const roomIds: string[] = [];
  const deps = runtimeDeps({
    presenceRooms: new Map([[room.id, privatePresence]]),
    store: {
      getRoom: async () => room,
      listVisibleRoomsForUser: async () => [{ ...room, relationship: 'bookmarked' }],
      listSummaryRecipientUserIds: async () => assert.fail('call recipient resolution'),
      getRoomUnreadCount: async () => assert.fail('call unread count')
    },
    wsRegistry: {
      sendToUser: () => assert.fail('call summary to account'),
      sendToConnection: () => assert.fail('call summary on readiness')
    }
  });
  const summaries = createRoomSummaries({ ...deps, logger: recordingLogger() });
  await summaries.flush(room.id);
  assert.equal(await summaries.sendToUser(room.id, 'alice'), false);
  await createFullTestRuntime(deps).sendAccountSummaries(fake(), 'alice');

  const ordinary: PresenceRoom = { ...privatePresence, id: 'ordinary', kind: 'main' };
  const stays = createVoiceStays({
    rooms: () => [privatePresence, ordinary],
    sessions: () => ({
      async recordSessions(sessions) {
        roomIds.push(...sessions.map((session) => session.roomId));
      }
    }),
    logger: recordingLogger
  });
  stays.recordPeerLeft(privatePresence, peer);
  await stays.recordOpenSessions();
  assert.deepEqual(roomIds, ['ordinary']);
});
