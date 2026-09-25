// Regression: a single room.peer.update must fan out exactly one
// room.peer.updated to each other active peer. Today broadcast() delivers
// once per peer transport AND once via mirrorLegacyRoomEvent to every
// detail subscriber (active peers are both), and updatePeerState mirrors a
// second time on top of broadcast — so the event is delivered 3x.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openWs, sendWs, joinVoiceRoom, waitForWsType } from './ws-harness.ts';
import { createTestDatabase } from './db-harness.ts';
import { request, socketDir, startServer, waitForHealthz, type ServerLogs } from './fakes/server-process.ts';

const PEER_A = 'peer-dup-a1';
const PEER_B = 'peer-dup-b1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('room.peer.update fans out exactly one room.peer.updated per other peer', async (t) => {
  const { dir, socketPath } = socketDir('voice-room-dup-');
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, { AUTH_RATE_LIMIT: '0' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await request<{ roomId: string }>(socketPath, { method: 'POST', pathname: '/api/rooms', body: {} });
    assert.equal(created.status, 201);
    const { roomId } = created.body;

    const alice = openWs(socketPath);
    await alice.ready;
    await joinVoiceRoom(alice, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Alice' });

    const bob = openWs(socketPath);
    await bob.ready;
    await joinVoiceRoom(bob, { roomId, peerId: PEER_B, sessionToken: TOKEN_B, name: 'Bob' });

    // Ensure Bob has seen Alice as a peer before we mutate her state.
    await waitForWsType(bob.frames, 'room.peer.joined', (frame) => frame.payload.peer.id === PEER_A).catch(() => {});

    const bobSince = bob.frames.length;

    // Alice mutes herself once.
    sendWs(alice.ws, 'room.peer.update', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      patch: { muted: true }
    });

    // Wait for the first updated event, then let any duplicates settle.
    await waitForWsType(bob.frames, 'room.peer.updated', (frame) => frame.payload.peer.id === PEER_A);
    await delay(200);

    const updatesForAlice = bob.frames
      .slice(bobSince)
      .filter((frame) => frame.type === 'room.peer.updated' && frame.payload.peer.id === PEER_A).length;

    assert.equal(
      updatesForAlice,
      1,
      `Bob received ${updatesForAlice} room.peer.updated events for a single update (expected 1)`
    );

    alice.ws.close();
    bob.ws.close();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});
