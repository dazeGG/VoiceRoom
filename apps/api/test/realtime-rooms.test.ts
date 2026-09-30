// Integration coverage for the WS room surface that the plan calls out:
//   - room.summary fan-out to visible/saved-room users with bounded visiblePeers
//     and an explicit hiddenPeerCount;
//   - preview subscribe delivers a snapshot then live peer diffs, and unsubscribe
//     stops those diffs;
//   - a connection that neither subscribed nor joined receives no room detail.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openWs, sendWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType, countWsType } from './ws-harness.ts';
import type { SignedIn } from '@voice-room/shared/contracts/account';
import type { RoomCreated } from '@voice-room/shared/contracts/rooms';
import { createTestDatabase } from './db-harness.ts';
import {
  cookieFrom,
  request,
  socketDir,
  startServer,
  waitForHealthz,
  type ServerLogs
} from './fakes/server-process.ts';

async function register(socketPath: string, login: string) {
  const response = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(response.status, 201);
  return { cookie: cookieFrom(response.setCookie), user: response.body.user };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function voiceCreds(index: number) {
  return {
    peerId: `peer-voice-${index}`,
    sessionToken: `vtoken${index}`.padEnd(32, '0'),
    name: `Peer ${index}`
  };
}

async function withServer(t: TestContext) {
  const { dir, socketPath } = socketDir('voice-room-rt-');
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });
  await waitForHealthz(socketPath);
  return { socketPath, logs };
}

test('room owner receives bounded room.summary as peers join and leave', async (t) => {
  const { socketPath, logs } = await withServer(t);
  try {
    const owner = await register(socketPath, 'summary-owner');
    const created = await request<RoomCreated>(socketPath, {
      method: 'POST',
      pathname: '/api/rooms',
      body: { isStatic: true },
      cookie: owner.cookie
    });
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    // Owner watches from the lobby (WS open, not previewing, not in voice).
    const ownerWs = openWs(socketPath, { cookie: owner.cookie });
    await ownerWs.ready;

    // Six guests join voice — one over the visible cap of five.
    const peers = [];
    for (let i = 1; i <= 6; i += 1) {
      const creds = voiceCreds(i);
      const peer = openWs(socketPath);
      await peer.ready;
      await joinVoiceRoom(peer, { roomId, ...creds });
      peers.push({ peer, creds });
    }

    const full = await waitForWsType(
      ownerWs.frames,
      'room.summary',
      (frame) => frame.payload.room.roomId === roomId && frame.payload.room.peers === 6
    );
    const summary = full.payload.room;
    assert.equal(summary.peers, 6);
    assert.equal(summary.visiblePeers.length, 5, 'visiblePeers must be capped at 5');
    assert.equal(summary.hiddenPeerCount, 1, 'hiddenPeerCount must be peers - visiblePeers');
    assert.ok(summary.visiblePeers.every((peer) => typeof peer.id === 'string'));

    // One peer explicitly leaves; a transport-only close now keeps presence
    // during the bounded reconnect lease.
    const sinceLeave = ownerWs.frames.length;
    const [leaving] = peers;
    assert.ok(leaving);
    sendWs(leaving.peer.ws, 'room.leave', {
      roomId,
      peerId: leaving.creds.peerId,
      sessionToken: leaving.creds.sessionToken
    });

    const afterLeave = await waitForWsType(
      ownerWs.frames,
      'room.summary',
      (frame) => frame.payload.room.roomId === roomId && frame.payload.room.peers === 5,
      5000,
      sinceLeave
    );
    assert.equal(afterLeave.payload.room.visiblePeers.length, 5);
    assert.equal(afterLeave.payload.room.hiddenPeerCount, 0);
    leaving.peer.ws.close();

    ownerWs.ws.close();
    for (const { peer } of peers) peer.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) console.error('Server stderr:\n', logs.stderr.trimEnd());
    throw error;
  }
});

test('preview subscribe streams peer diffs and unsubscribe stops them', async (t) => {
  const { socketPath, logs } = await withServer(t);
  try {
    const created = await request<RoomCreated>(socketPath, { method: 'POST', pathname: '/api/rooms', body: {} });
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    const viewer = openWs(socketPath);
    await viewer.ready;
    const snapshot = await subscribeRoomPreview(viewer, roomId);
    assert.equal(snapshot.type, 'room.snapshot');
    assert.equal(snapshot.payload.roomId, roomId);
    assert.deepEqual(snapshot.payload.peers, []);

    // A peer joins while previewing — the viewer receives a live diff.
    const first = voiceCreds(1);
    const firstPeer = openWs(socketPath);
    await firstPeer.ready;
    await joinVoiceRoom(firstPeer, { roomId, ...first });

    await waitForWsType(
      viewer.frames,
      'room.peer.joined',
      (frame) => frame.payload.roomId === roomId && frame.payload.peer?.id === first.peerId
    );

    // Stop previewing; further joins must not reach this connection.
    sendWs(viewer.ws, 'room.preview.unsubscribe', { roomId });
    await delay(100);
    const joinedBefore = countWsType(viewer.frames, 'room.peer.joined');

    const second = voiceCreds(2);
    const secondPeer = openWs(socketPath);
    await secondPeer.ready;
    await joinVoiceRoom(secondPeer, { roomId, ...second });
    await delay(200);

    const joinedAfter = countWsType(viewer.frames, 'room.peer.joined');
    assert.equal(joinedAfter, joinedBefore, 'unsubscribed viewer must not receive further peer diffs');

    viewer.ws.close();
    firstPeer.ws.close();
    secondPeer.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) console.error('Server stderr:\n', logs.stderr.trimEnd());
    throw error;
  }
});

test('idle connection receives no room detail without subscribe or join', async (t) => {
  const { socketPath, logs } = await withServer(t);
  try {
    const created = await request<RoomCreated>(socketPath, { method: 'POST', pathname: '/api/rooms', body: {} });
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    // An anonymous connection that does nothing after ready.
    const idle = openWs(socketPath);
    await idle.ready;

    // A peer joins the room the idle connection never subscribed to.
    const creds = voiceCreds(1);
    const peer = openWs(socketPath);
    await peer.ready;
    await joinVoiceRoom(peer, { roomId, ...creds });
    await delay(250);

    assert.equal(countWsType(idle.frames, 'room.snapshot'), 0, 'no snapshot without subscribe/join');
    assert.equal(countWsType(idle.frames, 'room.peer.joined'), 0, 'no peer diffs without subscribe/join');
    assert.equal(countWsType(idle.frames, 'room.summary'), 0, 'no summary for a non-recipient guest');

    idle.ws.close();
    peer.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) console.error('Server stderr:\n', logs.stderr.trimEnd());
    throw error;
  }
});
