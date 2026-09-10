'use strict';

const { socketPathForDirectory } = require('./ipc-harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');
const { joinVoiceRoom, openWs: openHarnessWs, subscribeRoomPreview, waitForWsType } = require('./ws-harness');

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-ws-'));
  return { dir, socketPath: socketPathForDirectory(dir) };
}

function waitForHealthz(socketPath, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get({ path: '/api/healthz', socketPath }, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Server did not become ready'));
        return;
      }
      setTimeout(attempt, 50);
    };
    attempt();
  });
}

function startServer(socketPath, databaseUrl, logs, extraEnv = {}) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      AUTH_RATE_LIMIT: '0',
      DATABASE_URL: databaseUrl,
      SOCKET_PATH: socketPath,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => {
    logs.stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs.stderr += chunk.toString();
  });
  return child;
}

function request(socketPath, { method = 'GET', pathname, body, cookie, headers = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const nextHeaders = { Accept: 'application/json', ...headers };
  if (payload) {
    nextHeaders['Content-Type'] = 'application/json';
    nextHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) nextHeaders.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers: nextHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
          setCookie: res.headers['set-cookie'] || []
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie) {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header || '').split(';')[0];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openWs(socketPath, cookie) {
  return openHarnessWs(socketPath, { cookie });
}

async function register(socketPath, login) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(response.status, 201);
  return cookieFrom(response.setCookie);
}

async function befriend(socketPath, requesterCookie, addresseeLogin) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/friends/requests',
    cookie: requesterCookie,
    body: { login: addresseeLogin }
  });
  assert.ok(response.status === 200 || response.status === 201);
}

async function acceptFirstRequest(socketPath, cookie) {
  const list = await request(socketPath, { pathname: '/api/friends/requests', cookie });
  assert.equal(list.status, 200);
  const requestId = list.body.incoming[0]?.id;
  assert.ok(requestId);
  const accepted = await request(socketPath, {
    method: 'POST',
    pathname: `/api/friends/requests/${encodeURIComponent(requestId)}/accept`,
    cookie,
    body: {}
  });
  assert.equal(accepted.status, 200);
}

test('ws accepts guest connections with guest ready payload', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const guest = openWs(socketPath);
  const ready = await guest.ready;
  assert.equal(ready.payload.guest, true);
  guest.ws.close();
});

test('DND settings update is broadcast to every open tab of the account', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);
  const cookie = await register(socketPath, 'dnd-tabs');
  const firstTab = openWs(socketPath, cookie);
  const secondTab = openWs(socketPath, cookie);
  await firstTab.ready;
  await secondTab.ready;

  const firstBefore = firstTab.frames.length;
  const secondBefore = secondTab.frames.length;
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/notifications/settings',
    cookie,
    body: { dnd: true }
  });
  assert.equal(response.status, 200);

  const firstUpdate = await waitForWsType(
    firstTab.frames,
    'notification.settings.updated',
    (frame) => frame.payload?.preferences?.doNotDisturb === true,
    5000,
    firstBefore
  );
  const secondUpdate = await waitForWsType(
    secondTab.frames,
    'notification.settings.updated',
    (frame) => frame.payload?.preferences?.doNotDisturb === true,
    5000,
    secondBefore
  );
  assert.deepEqual(firstUpdate.payload.preferences, response.body.preferences);
  assert.deepEqual(secondUpdate.payload.preferences, response.body.preferences);

  firstTab.ws.close();
  secondTab.ws.close();
});

test('ws pushes room summaries to authenticated users right after ready', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const ownerCookie = await register(socketPath, 'roomowner');
  const created = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    cookie: ownerCookie,
    body: { isStatic: true, name: 'Летучка' }
  });
  assert.equal(created.status, 201);
  const roomId = created.body.roomId;

  const guest = openHarnessWs(socketPath);
  await guest.ready;
  await joinVoiceRoom(guest, {
    roomId,
    peerId: 'guest-peer-summary-1',
    sessionToken: 'g'.repeat(32),
    name: 'Гость'
  });

  // The owner's lobby connection must learn the live roster without waiting
  // for the next room event: a room.summary push follows `ready`.
  const owner = openHarnessWs(socketPath, { cookie: ownerCookie });
  await owner.ready;
  const summary = await waitForWsType(
    owner.frames,
    'room.summary',
    (frame) => frame.payload?.room?.roomId === roomId
  );
  assert.equal(summary.payload.room.visiblePeers.length, 1);
  assert.equal(summary.payload.room.visiblePeers[0].name, 'Гость');

  guest.ws.close();
  owner.ws.close();
});

test('ws ready and friend.presence work for authenticated users', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const aliceCookie = await register(socketPath, 'alice');
  const bobCookie = await register(socketPath, 'bob');
  await befriend(socketPath, aliceCookie, 'bob');
  await acceptFirstRequest(socketPath, bobCookie);

  const bobFriends = await request(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice')?.user.id;
  assert.ok(aliceId);

  const bob = openWs(socketPath, bobCookie);
  const bobReady = await bob.ready;
  assert.ok(typeof bobReady.payload.userId === 'string');
  assert.equal(bobReady.payload.onlineFriendIds.length, 0);

  const presence = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bob did not receive friend.presence')), 5000);
    bob.ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw));
      if (parsed.type === 'friend.presence' && parsed.payload?.userId === aliceId) {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
  });

  const alice = openWs(socketPath, aliceCookie);
  const aliceReady = await alice.ready;
  assert.ok(Array.isArray(aliceReady.payload.onlineFriendIds));

  const seen = await presence;
  assert.equal(seen.type, 'friend.presence');
  assert.equal(seen.payload.online, true);

  bob.ws.close();
  alice.ws.close();
});

test('ws sends additive account notification envelopes without regressing legacy DM and friend events', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const aliceCookie = await register(socketPath, 'alice-notify');
  const bobCookie = await register(socketPath, 'bob-notify');
  const alice = openWs(socketPath, aliceCookie);
  const bob = openWs(socketPath, bobCookie);
  await alice.ready;
  await bob.ready;

  const requested = await request(socketPath, {
    method: 'POST',
    pathname: '/api/friends/requests',
    cookie: aliceCookie,
    body: { login: 'bob-notify' }
  });
  assert.equal(requested.status, 201);

  const legacyRequest = await waitForWsType(bob.frames, 'friend.request');
  assert.equal(legacyRequest.payload.direction, 'incoming');
  const notificationRequest = await waitForWsType(bob.frames, 'notification.friend.request');
  assert.equal(notificationRequest.payload.requester.login, 'alice-notify');
  assert.equal(notificationRequest.payload.requestId, notificationRequest.payload.dedupeKey.replace('friend-request:', ''));

  await acceptFirstRequest(socketPath, bobCookie);
  const legacyAccepted = await waitForWsType(alice.frames, 'friend.accepted');
  assert.ok(legacyAccepted.payload.userId);
  const notificationAccepted = await waitForWsType(alice.frames, 'notification.friend.accepted');
  assert.equal(notificationAccepted.payload.user.login, 'bob-notify');
  assert.match(notificationAccepted.payload.dedupeKey, /^friend-accepted:/);
  const bobFriends = await request(socketPath, { pathname: '/api/friends', cookie: bobCookie });
  assert.equal(bobFriends.status, 200);
  const aliceId = bobFriends.body.friends.find((entry) => entry.user.login === 'alice-notify')?.user.id;
  assert.ok(aliceId);

  const aliceBeforeDm = alice.frames.length;
  const sent = await request(socketPath, {
    method: 'POST',
    pathname: `/api/dm/${encodeURIComponent(legacyAccepted.payload.userId)}`,
    cookie: aliceCookie,
    body: { text: 'hello bob' }
  });
  assert.equal(sent.status, 201);

  const legacyDm = await waitForWsType(bob.frames, 'dm.message', (frame) => frame.payload?.message?.body === 'hello bob');
  assert.equal(legacyDm.payload.message.id, sent.body.message.id);
  const notificationDm = await waitForWsType(
    bob.frames,
    'notification.dm.message',
    (frame) => frame.payload?.message?.body === 'hello bob'
  );
  assert.equal(notificationDm.payload.dedupeKey, `dm:${sent.body.message.id}`);
  assert.equal(notificationDm.payload.peer.login, 'alice-notify');
  await waitForWsType(alice.frames, 'dm.message', (frame) => frame.payload?.message?.id === sent.body.message.id, 5000, aliceBeforeDm);
  await delay(150);
  assert.equal(alice.frames.slice(aliceBeforeDm).some((frame) => frame.type === 'notification.dm.message'), false);

  const muted = await request(socketPath, {
    method: 'PUT',
    pathname: `/api/notifications/dm/${encodeURIComponent(aliceId)}/mute`,
    cookie: bobCookie,
    body: { muted: true }
  });
  assert.equal(muted.status, 200);
  const mutedThread = await request(socketPath, {
    pathname: `/api/dm/${encodeURIComponent(aliceId)}`,
    cookie: bobCookie
  });
  assert.equal(mutedThread.status, 200);
  assert.equal(mutedThread.body.muted, true);
  const bobBeforeMutedDm = bob.frames.length;
  const mutedSent = await request(socketPath, {
    method: 'POST',
    pathname: `/api/dm/${encodeURIComponent(legacyAccepted.payload.userId)}`,
    cookie: aliceCookie,
    body: { text: 'muted but delivered' }
  });
  assert.equal(mutedSent.status, 201);
  await waitForWsType(
    bob.frames,
    'dm.message',
    (frame) => frame.payload?.message?.id === mutedSent.body.message.id,
    5000,
    bobBeforeMutedDm
  );
  await delay(150);
  assert.equal(bob.frames.slice(bobBeforeMutedDm).some((frame) => frame.type === 'notification.dm.message'), false);

  alice.ws.close();
  bob.ws.close();
});

test('ring works from the lobby for an active friend and delivers one invitation per cooldown', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, {
    RING_RATE_LIMIT: '1',
    RING_RATE_WINDOW_MS: '1000',
    RING_TTL_MS: '5000'
  });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);
  const aliceCookie = await register(socketPath, 'alice-ring');
  const bobCookie = await register(socketPath, 'bob-ring');
  const caraCookie = await register(socketPath, 'cara-ring');
  await befriend(socketPath, aliceCookie, 'bob-ring');
  await acceptFirstRequest(socketPath, bobCookie);

  const aliceFriends = await request(socketPath, { pathname: '/api/friends', cookie: aliceCookie });
  const bobId = aliceFriends.body.friends.find((entry) => entry.user.login === 'bob-ring')?.user.id;
  assert.ok(bobId);
  const caraSession = await request(socketPath, { pathname: '/api/auth/me', cookie: caraCookie });
  const caraId = caraSession.body.user.id;

  const created = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    cookie: aliceCookie,
    body: { isStatic: true, name: 'Ring Room' }
  });
  assert.equal(created.status, 201);
  const roomId = created.body.roomId;

  const beforeJoin = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/ring`,
    cookie: aliceCookie,
    body: { userId: bobId }
  });
  assert.equal(beforeJoin.status, 200);
  await delay(1100);

  const alice = openHarnessWs(socketPath, { cookie: aliceCookie });
  const bob = openWs(socketPath, bobCookie);
  await alice.ready;
  await bob.ready;
  const aliceSnapshot = await joinVoiceRoom(alice, {
    roomId,
    peerId: 'alice-ring-peer',
    sessionToken: 'r'.repeat(32),
    name: 'Alice Ring'
  });
  // The active snapshot carries the in-memory call clock for the timers.
  assert.ok(Number(aliceSnapshot.payload.voiceActiveSince) > 0);

  const nonFriend = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/ring`,
    cookie: aliceCookie,
    body: { userId: caraId }
  });
  assert.equal(nonFriend.status, 403);

  const sentAt = Date.now();
  const sent = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/ring`,
    cookie: aliceCookie,
    body: { userId: bobId }
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);

  const incoming = await waitForWsType(bob.frames, 'ring.incoming');
  assert.equal(incoming.payload.fromUser.login, 'alice-ring');
  assert.deepEqual(incoming.payload.room, { id: roomId, name: 'Ring Room', emoji: '' });
  assert.ok(incoming.payload.expiresAt >= sentAt + 4500);
  assert.ok(incoming.payload.expiresAt <= Date.now() + 5000);

  // The ring also lands in the shared DM thread as an invitation message.
  const inviteEvent = await waitForWsType(bob.frames, 'dm.message');
  const inviteMessage = inviteEvent.payload.message;
  assert.ok(inviteMessage.id);
  assert.equal(inviteMessage.invite.roomId, roomId);
  assert.equal(inviteMessage.invite.roomName, 'Ring Room');
  assert.equal(inviteMessage.invite.status, 'pending');
  assert.equal(inviteMessage.invite.expiresAt, null);
  assert.match(inviteMessage.body, /Ring Room/);

  // Only the invited recipient may respond; the sender gets a 403.
  const bySender = await request(socketPath, {
    method: 'POST',
    pathname: `/api/dm/${encodeURIComponent(bobId)}/invites/${encodeURIComponent(inviteMessage.id)}/respond`,
    cookie: aliceCookie,
    body: { action: 'accept' }
  });
  assert.equal(bySender.status, 403);

  // Bob accepts: both sides converge through a dm.message.edited fan-out.
  const responded = await request(socketPath, {
    method: 'POST',
    pathname: `/api/dm/${encodeURIComponent(inviteMessage.senderId)}/invites/${encodeURIComponent(inviteMessage.id)}/respond`,
    cookie: bobCookie,
    body: { action: 'accept' }
  });
  assert.equal(responded.status, 200);
  assert.equal(responded.body.message.invite.status, 'accepted');

  const edited = await waitForWsType(alice.frames, 'dm.message.edited');
  assert.equal(edited.payload.message.id, inviteMessage.id);
  assert.equal(edited.payload.message.invite.status, 'accepted');

  // Responding twice is a conflict: the invite is no longer pending.
  const again = await request(socketPath, {
    method: 'POST',
    pathname: `/api/dm/${encodeURIComponent(inviteMessage.senderId)}/invites/${encodeURIComponent(inviteMessage.id)}/respond`,
    cookie: bobCookie,
    body: { action: 'decline' }
  });
  assert.equal(again.status, 409);

  const repeated = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/ring`,
    cookie: aliceCookie,
    body: { userId: bobId }
  });
  assert.equal(repeated.status, 429);
  assert.ok(Number(repeated.body.retryAfterSeconds) > 0);

  await delay(1100);
  const bobBeforeSecondInvite = bob.frames.length;
  const second = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/ring`,
    cookie: aliceCookie,
    body: { userId: bobId }
  });
  assert.equal(second.status, 200);
  const secondInvite = await waitForWsType(
    bob.frames,
    'dm.message',
    (frame) => frame.payload?.message?.invite?.status === 'pending',
    5000,
    bobBeforeSecondInvite
  );

  const bobBeforeLeave = bob.frames.length;
  alice.ws.send(JSON.stringify({
    type: 'room.leave',
    payload: { roomId, peerId: 'alice-ring-peer', sessionToken: 'r'.repeat(32) }
  }));
  await delay(250);
  const peersAfterLeave = await request(socketPath, {
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/peers`,
    cookie: bobCookie
  });
  assert.equal(peersAfterLeave.body.peers.some((peer) => peer.accountUserId === inviteMessage.senderId), false);
  const threadAfterLeave = await request(socketPath, {
    pathname: `/api/dm/${encodeURIComponent(inviteMessage.senderId)}`,
    cookie: bobCookie
  });
  assert.equal(
    threadAfterLeave.body.messages.find((message) => message.id === secondInvite.payload.message.id)?.invite?.status,
    'pending'
  );
  assert.equal(
    bob.frames.slice(bobBeforeLeave).some((frame) =>
      frame.type === 'dm.message.edited'
      && frame.payload?.message?.id === secondInvite.payload.message.id
    ),
    false
  );

  const bobBeforeDelete = bob.frames.length;
  const deletedRoom = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}`,
    cookie: aliceCookie
  });
  assert.equal(deletedRoom.status, 200);
  const expired = await waitForWsType(
    bob.frames,
    'dm.message.edited',
    (frame) => frame.payload?.message?.id === secondInvite.payload.message.id,
    5000,
    bobBeforeDelete
  );
  assert.equal(expired.payload.message.invite.status, 'expired');

  alice.ws.close();
  bob.ws.close();
});

test('ws sends saved-room message notifications with sender exclusion', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const ownerCookie = await register(socketPath, 'room-owner-notify');
  const posterCookie = await register(socketPath, 'room-poster-notify');
  const created = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms',
    cookie: ownerCookie,
    body: { isStatic: true, name: 'Daily Room', emoji: '☕' }
  });
  assert.equal(created.status, 201);
  const roomId = created.body.roomId;

  const owner = openHarnessWs(socketPath, { cookie: ownerCookie });
  const poster = openHarnessWs(socketPath, { cookie: posterCookie });
  await owner.ready;
  await poster.ready;
  await subscribeRoomPreview(owner, roomId);

  const beforeOwnerJoin = owner.frames.length;
  await joinVoiceRoom(owner, {
    roomId,
    peerId: 'owner-notify-peer',
    sessionToken: 'o'.repeat(32),
    name: 'Owner Notify'
  });
  await waitForWsType(owner.frames, 'room.snapshot', (frame) => frame.payload?.roomId === roomId, 5000, beforeOwnerJoin);
  const ownerVoiceBefore = owner.frames.length;
  const ownerVoicePost = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/chat`,
    body: {
      peerId: 'owner-notify-peer',
      sessionToken: 'o'.repeat(32),
      text: 'owner voice post'
    }
  });
  assert.equal(ownerVoicePost.status, 201);
  await waitForWsType(
    owner.frames,
    'room.chat.message',
    (frame) => frame.payload?.message?.id === ownerVoicePost.body.message.id,
    5000,
    ownerVoiceBefore
  );
  await delay(150);
  assert.equal(owner.frames.slice(ownerVoiceBefore).some((frame) => frame.type === 'notification.room.message'), false);

  const ownerBefore = owner.frames.length;
  const posterBefore = poster.frames.length;
  const posted = await request(socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${encodeURIComponent(roomId)}/chat`,
    cookie: posterCookie,
    body: { text: 'standup starts' }
  });
  assert.equal(posted.status, 201);

  await waitForWsType(owner.frames, 'room.chat.message', (frame) => frame.payload?.message?.id === posted.body.message.id, 5000, ownerBefore);
  const notification = await waitForWsType(
    owner.frames,
    'notification.room.message',
    (frame) => frame.payload?.message?.id === posted.body.message.id,
    5000,
    ownerBefore
  );
  assert.equal(notification.payload.dedupeKey, `room:${roomId}:message:${posted.body.message.id}`);
  assert.equal(notification.payload.room.name, 'Daily Room');
  assert.equal(notification.payload.sender.login, 'room-poster-notify');
  await delay(150);
  assert.equal(poster.frames.slice(posterBefore).some((frame) => frame.type === 'notification.room.message'), false);

  owner.ws.close();
  poster.ws.close();
});

test('ws pushes friend.updated to friends after avatar upload and delete', async (t) => {
  const sharp = require('sharp');
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-ws-avatars-'));
  const child = startServer(socketPath, databaseUrl, logs, { UPLOADS_DIR: uploadsDir });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    return cleanup();
  });

  await waitForHealthz(socketPath);

  const anyaCookie = await register(socketPath, 'anya-avatar');
  const borisCookie = await register(socketPath, 'boris-avatar');
  await befriend(socketPath, anyaCookie, 'boris-avatar');
  await acceptFirstRequest(socketPath, borisCookie);

  const boris = openWs(socketPath, borisCookie);
  await boris.ready;

  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 40 } }
  }).png().toBuffer();
  const boundary = '----voice-room-ws-avatar';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const uploaded = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        path: '/api/auth/avatar',
        socketPath,
        headers: {
          Accept: 'application/json',
          Cookie: anyaCookie,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  assert.equal(uploaded.status, 200);
  assert.ok(uploaded.body.user.avatarUrl);

  const updated = await waitForWsType(
    boris.frames,
    'friend.updated',
    (frame) => frame.payload?.user?.login === 'anya-avatar'
  );
  assert.equal(updated.payload.user.avatarUrl, uploaded.body.user.avatarUrl);

  const borisBeforeDelete = boris.frames.length;
  const deleted = await request(socketPath, { method: 'DELETE', pathname: '/api/auth/avatar', cookie: anyaCookie });
  assert.equal(deleted.status, 200);
  const cleared = await waitForWsType(
    boris.frames,
    'friend.updated',
    (frame) => frame.payload?.user?.login === 'anya-avatar',
    5000,
    borisBeforeDelete
  );
  assert.equal(cleared.payload.user.avatarUrl, null);

  boris.ws.close();
});
