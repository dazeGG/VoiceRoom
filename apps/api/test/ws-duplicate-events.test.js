'use strict';

// Regression: a single room.peer.update must fan out exactly one
// room.peer.updated to each other active peer. Today broadcast() delivers
// once per peer transport AND once via mirrorLegacyRoomEvent to every
// detail subscriber (active peers are both), and updatePeerState mirrors a
// second time on top of broadcast — so the event is delivered 3x.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { openWs, sendWs, joinVoiceRoom, waitForWsType, countWsType } = require('./ws-harness');
const { createTestDatabase } = require('./db-harness');

const PEER_A = 'peer-dup-a1';
const PEER_B = 'peer-dup-b1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-dup-'));
  return { dir, socketPath: path.join(dir, 'api.sock') };
}

function waitForHealthz(socketPath, timeoutMs = 5000) {
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

function startServer(socketPath, databaseUrl, logs) {
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
      SOCKET_PATH: socketPath
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

function postJson(socketPath, pathname, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        path: pathname,
        socketPath,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
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
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('room.peer.update fans out exactly one room.peer.updated per other peer', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson(socketPath, '/api/rooms', {});
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    const alice = openWs(socketPath);
    await alice.ready;
    await joinVoiceRoom(alice, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Alice' });

    const bob = openWs(socketPath);
    await bob.ready;
    await joinVoiceRoom(bob, { roomId, peerId: PEER_B, sessionToken: TOKEN_B, name: 'Bob' });

    // Ensure Bob has seen Alice as a peer before we mutate her state.
    await waitForWsType(bob.frames, 'room.peer.joined', (frame) => frame.payload?.peer?.id === PEER_A).catch(
      () => {}
    );

    const bobSince = bob.frames.length;

    // Alice mutes herself once.
    sendWs(alice.ws, 'room.peer.update', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      patch: { muted: true }
    });

    // Wait for the first updated event, then let any duplicates settle.
    await waitForWsType(
      bob.frames,
      'room.peer.updated',
      (frame) => frame.payload?.peer?.id === PEER_A
    );
    await delay(200);

    const updatesForAlice = bob.frames
      .slice(bobSince)
      .filter((frame) => frame.type === 'room.peer.updated' && frame.payload?.peer?.id === PEER_A).length;

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
