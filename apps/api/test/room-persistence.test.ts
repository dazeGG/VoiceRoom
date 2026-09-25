import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { RoomCreated, RoomStatus } from '@voice-room/shared/contracts/rooms';
import { createTestDatabase } from './db-harness.ts';
import {
  cookieFrom,
  dumpServerLogs,
  getJson,
  postJson,
  socketDir,
  startServer,
  waitForHealthz,
  type ServerLogs
} from './fakes/server-process.ts';
import { openWs, joinVoiceRoom } from './ws-harness.ts';

test('room registry survives restart and preserves the static flag', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const serverLogs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, serverLogs, { ROOM_IDLE_TTL_MS: '60000' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const dynamicRoom = await postJson<RoomCreated>(socketPath, '/api/rooms', {});
    assert.equal(dynamicRoom.status, 201);
    assert.equal(dynamicRoom.body.isStatic, false);

    const registered = await postJson(socketPath, '/api/auth/register', {
      login: 'persist-owner',
      password: 'password123'
    });
    assert.equal(registered.status, 201);

    const staticRoom = await postJson<RoomCreated>(
      socketPath,
      '/api/rooms',
      { isStatic: true },
      cookieFrom(registered.setCookie)
    );
    assert.equal(staticRoom.status, 201);
    assert.equal(staticRoom.body.isStatic, true);

    const dynamicBeforeRestart = await getJson<RoomStatus>(socketPath, `/api/rooms/${dynamicRoom.body.roomId}`);
    assert.equal(dynamicBeforeRestart.status, 200);
    assert.equal(dynamicBeforeRestart.body.exists, true);
    assert.equal(dynamicBeforeRestart.body.isStatic, false);
    assert.equal((dynamicBeforeRestart.body.emptySince ?? 0) > 0, true);

    const createdAt = dynamicBeforeRestart.body.createdAt;
    const staticCreatedAt = staticRoom.body.createdAt;

    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));

    const restartLogs: ServerLogs = { stdout: '', stderr: '' };
    const restarted = startServer(socketPath, databaseUrl, restartLogs, { ROOM_IDLE_TTL_MS: '60000' });
    t.after(() => {
      restarted.kill('SIGTERM');
    });

    try {
      await waitForHealthz(socketPath);

      const dynamicAfterRestart = await getJson<RoomStatus>(socketPath, `/api/rooms/${dynamicRoom.body.roomId}`);
      assert.equal(dynamicAfterRestart.status, 200);
      assert.equal(dynamicAfterRestart.body.exists, true);
      assert.equal(dynamicAfterRestart.body.isStatic, false);
      assert.equal(dynamicAfterRestart.body.createdAt, createdAt);

      const staticAfterRestart = await getJson<RoomStatus>(socketPath, `/api/rooms/${staticRoom.body.roomId}`);
      assert.equal(staticAfterRestart.status, 200);
      assert.equal(staticAfterRestart.body.exists, true);
      assert.equal(staticAfterRestart.body.isStatic, true);
      assert.equal(staticAfterRestart.body.createdAt, staticCreatedAt);
    } finally {
      restarted.kill('SIGTERM');
    }
  } catch (error) {
    dumpServerLogs(serverLogs);
    throw error;
  }
});

test('temporary empty rooms count toward per-IP room quota', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, { ROOM_IDLE_TTL_MS: '60000', MAX_TEMP_ROOMS_PER_IP: '1' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const tempRoom = await postJson<RoomCreated>(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(tempRoom.status, 201);
    assert.equal(tempRoom.body.isStatic, false);

    const blocked = await postJson<RoomCreated>(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many temporary rooms waiting from this IP, reuse one or try later');
  } catch (error) {
    dumpServerLogs(logs);
    throw error;
  }
});

test('active temporary rooms stay counted toward per-IP room creation quota', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, { ROOM_IDLE_TTL_MS: '60000', MAX_TEMP_ROOMS_PER_IP: '1' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const tempRoom = await postJson<RoomCreated>(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(tempRoom.status, 201);
    assert.equal(tempRoom.body.isStatic, false);

    const joined = openWs(socketPath);
    t.after(() => joined.ws.close());
    await joined.ready;
    await joinVoiceRoom(joined, {
      roomId: tempRoom.body.roomId,
      peerId: 'peer-aaaa',
      sessionToken: 'token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Alice'
    });

    const blocked = await postJson<RoomCreated>(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many temporary rooms waiting from this IP, reuse one or try later');
  } catch (error) {
    dumpServerLogs(logs);
    throw error;
  }
});
