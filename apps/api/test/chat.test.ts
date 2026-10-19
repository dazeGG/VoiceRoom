import test from 'node:test';
import { SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import { RoomChat, RoomMessageAnswer } from '@voice-room/shared/contracts/messages';
import { RoomCreated, RoomStatus } from '@voice-room/shared/contracts/rooms';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { TSchema } from 'typebox';
import { createTestDatabase } from './db-harness.ts';
import {
  cookieFrom,
  request,
  socketDir,
  startServer,
  waitForHealthz,
  type ServerLogs
} from './fakes/server-process.ts';
import { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType } from './ws-harness.ts';

type CookieOption = { cookie?: string };

/** POST with the session cookie of `cookie`; the answer carries the first Set-Cookie as `name=value`. */
async function postJson<const Schema extends TSchema>(
  socketPath: string,
  pathname: string,
  schema: Schema,
  body: unknown,
  { cookie }: CookieOption = {}
) {
  const response = await request(socketPath, { method: 'POST', pathname, body, cookie }, schema);
  return { ...response, setCookie: cookieFrom(response.setCookie) };
}

function patchJson<const Schema extends TSchema>(
  socketPath: string,
  pathname: string,
  schema: Schema,
  body: unknown,
  { cookie }: CookieOption = {}
) {
  return request(socketPath, { method: 'PATCH', pathname, body, cookie }, schema);
}

function getJson<const Schema extends TSchema>(socketPath: string, pathname: string, schema: Schema) {
  return request(socketPath, { pathname }, schema);
}

const PEER_ID = 'peer-chat1';
const TOKEN = 'c'.repeat(32);

test('chat API persists, streams, and respects room auth', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson(socketPath, '/api/rooms', RoomCreated, {});
    assert.equal(created.status, 201);

    const voice = openWs(socketPath);
    await voice.ready;
    await joinVoiceRoom(voice, {
      roomId: created.body.roomId,
      peerId: PEER_ID,
      sessionToken: TOKEN,
      name: 'Alice'
    });

    const empty = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomChat);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.messages, []);

    const posted = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomMessageAnswer, {
      name: 'Alice',
      peerId: PEER_ID,
      sessionToken: TOKEN,
      text: 'Привет, чат!'
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.message.text, 'Привет, чат!');

    const streamed = await waitForWsType(
      voice.frames,
      'room.chat.message',
      (frame) => frame.payload.message.text === 'Привет, чат!'
    );
    assert.equal(streamed.payload.message.text, 'Привет, чат!');

    const rejectedEdit = await patchJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat/${posted.body.message.id}`,
      Failure,
      { peerId: PEER_ID, sessionToken: 'x'.repeat(32), text: 'spoofed edit' }
    );
    assert.equal(rejectedEdit.status, 403);

    const edited = await patchJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat/${posted.body.message.id}`,
      RoomMessageAnswer,
      {
        peerId: PEER_ID,
        sessionToken: TOKEN,
        text: '  Изменено\n\n\nс сохранением строк  '
      }
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.body.message.text, 'Изменено\n\nс сохранением строк');
    assert.equal(typeof edited.body.message.editedAt, 'number');

    const streamedEdit = await waitForWsType(
      voice.frames,
      'room.chat.edited',
      (frame) => frame.payload.message.id === posted.body.message.id
    );
    assert.equal(streamedEdit.payload.message.text, 'Изменено\n\nс сохранением строк');
    assert.equal(streamedEdit.payload.message.editedAt, edited.body.message.editedAt);

    const after = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomChat);
    assert.equal(after.status, 200);
    assert.equal(after.body.messages.length, 1);
    assert.equal(after.body.messages[0]?.text, 'Изменено\n\nс сохранением строк');
    assert.equal(after.body.messages[0]?.editedAt, edited.body.message.editedAt);

    // 2.4.0: multiline preserved (newlines, limited blank lines, line count cap)
    const multi = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomMessageAnswer, {
      name: 'Alice',
      peerId: PEER_ID,
      sessionToken: TOKEN,
      text: 'line1\n\n\nline2\nline3'
    });
    assert.equal(multi.status, 201);
    // collapses 3+ \n to 2, keeps \n
    assert.equal(multi.body.message.text, 'line1\n\nline2\nline3');

    voice.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API rejects anonymous room-link posting without active presence', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson(socketPath, '/api/rooms', RoomCreated, { isStatic: false });
    assert.equal(created.status, 201);

    const preview = openWs(socketPath);
    await preview.ready;
    await subscribeRoomPreview(preview, created.body.roomId);

    const posted = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, Failure, {
      name: 'Link Guest',
      text: 'Пишу без входа в голос'
    });
    assert.equal(posted.status, 403);
    assert.equal(posted.body.error, 'Active room presence or login required');

    const after = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomChat);
    assert.equal(after.status, 200);
    assert.equal(after.body.messages.length, 0);

    preview.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('account chat uses the current profile and refreshes active room peers after rename', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const registered = await postJson(socketPath, '/api/auth/register', SignedIn, {
      login: 'preview-chat-user',
      displayName: 'Preview User',
      password: 'password123',
      passwordConfirm: 'password123'
    });
    assert.equal(registered.status, 201);
    const sessionCookie = registered.setCookie;
    const accountPeerId = `auth-${registered.body.user.id}`;

    const created = await postJson(socketPath, '/api/rooms', RoomCreated, { isStatic: false });
    assert.equal(created.status, 201);

    const voice = openWs(socketPath, { cookie: sessionCookie });
    await voice.ready;
    const joined = await joinVoiceRoom(voice, {
      roomId: created.body.roomId,
      peerId: 'preview-voice-user',
      sessionToken: TOKEN,
      name: 'Ignored client name'
    });
    assert.equal(joined.payload.peers.find((peer) => peer.id === 'preview-voice-user')?.name, 'Preview User');

    const first = await postJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat`,
      RoomMessageAnswer,
      {
        name: 'Spoofed Name',
        text: 'Первое сообщение из превью'
      },
      { cookie: sessionCookie }
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.message.peerId, accountPeerId);
    assert.equal(first.body.message.name, 'Preview User');
    assert.equal(first.body.message.avatarColorKey, registered.body.user.avatarColorKey);

    const second = await postJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat`,
      RoomMessageAnswer,
      {
        name: 'Another Spoof',
        text: 'Второе сообщение из превью'
      },
      { cookie: sessionCookie }
    );
    assert.equal(second.status, 201);
    assert.equal(second.body.message.peerId, accountPeerId);
    assert.equal(second.body.message.name, 'Preview User');
    assert.equal(second.body.message.avatarColorKey, first.body.message.avatarColorKey);

    // An account-backed active peer remains authoritative even if its HTTP
    // session cookie is absent; the request body cannot spoof the live name.
    const beforeActivePeerPost = voice.frames.length;
    const activePeerPost = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomMessageAnswer, {
      name: 'Spoofed Active Name',
      peerId: 'preview-voice-user',
      sessionToken: TOKEN,
      text: 'Сообщение из активной комнаты без cookie'
    });
    assert.equal(activePeerPost.status, 201);
    assert.equal(activePeerPost.body.message.name, 'Preview User');
    assert.equal(activePeerPost.body.message.authorUserId, registered.body.user.id);
    const activePeerBroadcast = await waitForWsType(
      voice.frames,
      'room.chat.message',
      (frame) => frame.payload.message.id === activePeerPost.body.message.id,
      5000,
      beforeActivePeerPost
    );
    assert.equal(activePeerBroadcast.payload.message.name, 'Preview User');

    const beforeRename = voice.frames.length;
    const renamed = await postJson(
      socketPath,
      '/api/auth/profile',
      SignedIn,
      { displayName: 'Current Profile' },
      { cookie: sessionCookie }
    );
    assert.equal(renamed.status, 200);

    const peerUpdated = await waitForWsType(
      voice.frames,
      'room.peer.updated',
      (frame) => frame.payload.peer.id === 'preview-voice-user',
      5000,
      beforeRename
    );
    assert.equal(peerUpdated.payload.peer.name, 'Current Profile');

    const history = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomChat);
    assert.equal(history.status, 200);
    assert.deepEqual(
      history.body.messages.map((message) => message.name),
      ['Current Profile', 'Current Profile', 'Current Profile']
    );

    voice.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API returns not found when posting to a missing room', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const posted = await postJson(socketPath, '/api/rooms/missing-room1/chat', Failure, {
      name: 'Link Guest',
      text: 'hello?'
    });
    assert.equal(posted.status, 404);
    assert.equal(posted.body.error, 'Room not found');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API still protects active voice peer identities', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson(socketPath, '/api/rooms', RoomCreated, {});
    assert.equal(created.status, 201);

    const voice = openWs(socketPath);
    await voice.ready;
    await joinVoiceRoom(voice, {
      roomId: created.body.roomId,
      peerId: PEER_ID,
      sessionToken: TOKEN,
      name: 'Alice'
    });

    const spoofed = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, Failure, {
      name: 'Mallory',
      peerId: PEER_ID,
      text: 'spoof'
    });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.body.error, 'Invalid peer session');

    const valid = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomMessageAnswer, {
      name: 'Alice',
      peerId: PEER_ID,
      sessionToken: TOKEN,
      text: 'valid'
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.message.peerId, PEER_ID);

    voice.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API rate limits room-link posts per room and IP', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, {
    ROOM_CHAT_RATE_LIMIT: '1',
    ROOM_CHAT_RATE_WINDOW_MS: '60000'
  });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const registered = await postJson(socketPath, '/api/auth/register', SignedIn, {
      login: 'rate-chat-user',
      password: 'password123',
      passwordConfirm: 'password123'
    });
    assert.equal(registered.status, 201);
    const sessionCookie = registered.setCookie;

    const created = await postJson(socketPath, '/api/rooms', RoomCreated, { isStatic: false });
    assert.equal(created.status, 201);

    const first = await postJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat`,
      RoomMessageAnswer,
      {
        name: 'Link Guest',
        text: 'first'
      },
      { cookie: sessionCookie }
    );
    assert.equal(first.status, 201);

    const second = await postJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat`,
      Failure,
      {
        name: 'Link Guest',
        text: 'second'
      },
      { cookie: sessionCookie }
    );
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'Too many chat messages');
    assert.equal(typeof second.body.retryAfterSeconds, 'number');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('manual static-room chat scenario survives API restart without voice join', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  let child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const registered = await postJson(socketPath, '/api/auth/register', SignedIn, {
      login: 'manual-owner',
      password: 'password123'
    });
    assert.equal(registered.status, 201);
    const sessionCookie = registered.setCookie;

    const created = await postJson(
      socketPath,
      '/api/rooms',
      RoomCreated,
      { isStatic: true },
      { cookie: sessionCookie }
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.isStatic, true);

    const statusBeforeRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}`, RoomStatus);
    assert.equal(statusBeforeRestart.status, 200);
    assert.equal(statusBeforeRestart.body.exists, true);
    assert.equal(statusBeforeRestart.body.isStatic, true);

    const posted = await postJson(
      socketPath,
      `/api/rooms/${created.body.roomId}/chat`,
      RoomMessageAnswer,
      {
        name: 'Manual Guest',
        text: 'Сообщение до перезапуска API'
      },
      { cookie: sessionCookie }
    );
    assert.equal(posted.status, 201);
    assert.equal(posted.body.message.peerId, `auth-${registered.body.user.id}`);

    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));

    const restartLogs: ServerLogs = { stdout: '', stderr: '' };
    child = startServer(socketPath, databaseUrl, restartLogs);
    await waitForHealthz(socketPath);

    const statusAfterRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}`, RoomStatus);
    assert.equal(statusAfterRestart.status, 200);
    assert.equal(statusAfterRestart.body.exists, true);
    assert.equal(statusAfterRestart.body.isStatic, true);

    const chatAfterRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, RoomChat);
    assert.equal(chatAfterRestart.status, 200);
    assert.equal(chatAfterRestart.body.messages.length, 1);
    assert.equal(chatAfterRestart.body.messages[0]?.id, posted.body.message.id);
    assert.equal(chatAfterRestart.body.messages[0]?.text, 'Сообщение до перезапуска API');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});
