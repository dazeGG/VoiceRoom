import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestDatabase } from './db-harness.ts';
import {
  dumpServerLogs,
  postJson,
  socketDir,
  startServer,
  wait,
  waitForHealthz,
  type ServerLogs
} from './fakes/server-process.ts';
import { openWs, joinVoiceRoom, sendRawWs, sendWs, waitForWsType } from './ws-harness.ts';
import type { PeerState, RoomCreated } from '@voice-room/shared/contracts/rooms';

const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

test('WS reconnect preserves presence and avoids spurious join/leave events', async (t) => {
  const { dir, socketPath } = socketDir();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const serverLogs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, serverLogs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson<RoomCreated>(socketPath, '/api/rooms', {});
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    const peerA = openWs(socketPath);
    await peerA.ready;
    await joinVoiceRoom(peerA, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Alice' });

    const peerB = openWs(socketPath);
    await peerB.ready;
    await joinVoiceRoom(peerB, { roomId, peerId: PEER_B, sessionToken: TOKEN_B, name: 'Bob' });
    await wait(100);

    const updateStart = peerB.frames.length;
    sendWs(peerA.ws, 'room.peer.update', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      patch: { muted: true, deafened: true, screen: true }
    });
    const updated = await waitForWsType(
      peerB.frames,
      'room.peer.updated',
      (frame) => frame.payload.peer.id === PEER_A,
      5000,
      updateStart
    );
    assert.equal(updated.payload.peer.muted, true);
    assert.equal(updated.payload.peer.deafened, true);
    assert.equal(updated.payload.peer.screen, true);

    const attendanceStart = peerA.frames.length;
    sendWs(peerB.ws, 'room.peer.update', {
      roomId,
      peerId: PEER_B,
      sessionToken: TOKEN_B,
      patch: { viewedScreenPeerId: PEER_A }
    });
    await waitForWsType(
      peerA.frames,
      'room.peer.updated',
      (frame) => frame.payload.peer.id === PEER_B && frame.payload.peer.viewedScreenPeerId === PEER_A,
      5000,
      attendanceStart
    );
    const beforeReconnect = peerB.frames.length;

    peerA.ws.close();
    await wait(150);
    const peerA2 = openWs(socketPath);
    await peerA2.ready;
    await joinVoiceRoom(peerA2, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Evil' });
    await wait(150);

    const reconnectEvents = peerB.frames
      .slice(beforeReconnect)
      .filter((frame) => frame.type === 'room.peer.joined' || frame.type === 'room.peer.left');
    assert.equal(reconnectEvents.length, 0);

    const peerA3 = openWs(socketPath);
    await peerA3.ready;
    await joinVoiceRoom(peerA3, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Still Evil' });
    const beforeStaleLeave = peerB.frames.length;
    // A leave without the session token is refused, so the replaced socket cannot remove the peer.
    sendRawWs(peerA2.ws, { type: 'room.leave', payload: { roomId, peerId: PEER_A } });
    await wait(150);
    const afterStaleLeave = await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A
    });
    assert.equal(afterStaleLeave.status, 200);
    assert.equal(
      peerB.frames.slice(beforeStaleLeave).some((frame) => frame.type === 'room.peer.left'),
      false
    );

    const beforeStaleWrite = peerB.frames.length;
    const staleWrite = await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      muted: false,
      deafened: false,
      screen: false
    });
    assert.equal(staleWrite.status, 409);
    assert.equal(staleWrite.body.code, 'state_updates_require_websocket');

    const state = await postJson<PeerState>(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A
    });
    assert.equal(state.status, 200);
    assert.equal(state.body.peer.name, 'Alice');
    assert.equal(state.body.peer.muted, true);
    assert.equal(state.body.peer.deafened, true);
    assert.equal(state.body.peer.screen, true);

    const viewerState = await postJson<PeerState>(socketPath, '/api/state', {
      roomId,
      peerId: PEER_B,
      sessionToken: TOKEN_B
    });
    assert.equal(viewerState.status, 200);
    assert.equal(viewerState.body.peer.viewedScreenPeerId, PEER_A);
    assert.equal(
      peerB.frames.slice(beforeStaleWrite).some((frame) => frame.type === 'room.peer.updated'),
      false
    );

    peerA2.ws.close();
    peerA3.ws.close();
    peerB.ws.close();
  } catch (error) {
    dumpServerLogs(serverLogs);
    throw error;
  }
});
