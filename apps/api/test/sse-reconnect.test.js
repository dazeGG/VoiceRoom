'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');
const { openWs, joinVoiceRoom, waitForWsType } = require('./ws-harness');

const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-sock-'));
  return {
    dir,
    socketPath: path.join(dir, 'api.sock')
  };
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
      DATABASE_URL: databaseUrl,
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      MAX_EMPTY_ROOMS_PER_IP: '0',
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

function dumpServerLogs(logs) {
  if (logs.stderr.trim()) {
    console.error('Server stderr:\n', logs.stderr.trimEnd());
  }
  if (logs.stdout.trim()) {
    console.error('Server stdout:\n', logs.stdout.trimEnd());
  }
}

async function postJson(socketPath, pathname, body) {
  const payload = JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        path: pathname,
        method: 'POST',
        socketPath,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      resolve
    );
    req.on('error', reject);
    req.end(payload);
  });

  const text = await new Promise((resolve, reject) => {
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => resolve(data));
    response.on('error', reject);
  });

  return {
    status: response.statusCode,
    body: text ? JSON.parse(text) : null
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('WS reconnect preserves presence and avoids spurious join/leave events', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const serverLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, serverLogs);
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

    const peerA = openWs(socketPath);
    await peerA.ready;
    await joinVoiceRoom(peerA, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Alice' });

    const peerB = openWs(socketPath);
    await peerB.ready;
    await joinVoiceRoom(peerB, { roomId, peerId: PEER_B, sessionToken: TOKEN_B, name: 'Bob' });
    await wait(100);

    await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      muted: true,
      deafened: true
    });
    const updated = await waitForWsType(peerB.frames, 'room.peer.updated', (frame) => frame.payload?.peer?.id === PEER_A);
    assert.equal(updated.payload.peer.muted, true);
    assert.equal(updated.payload.peer.deafened, true);
    const beforeReconnect = peerB.frames.length;

    const peerA2 = openWs(socketPath);
    await peerA2.ready;
    await joinVoiceRoom(peerA2, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Evil' });
    peerA.ws.close();
    await wait(150);

    const reconnectEvents = peerB.frames.slice(beforeReconnect).filter((frame) =>
      frame.type === 'room.peer.joined' || frame.type === 'room.peer.left'
    );
    assert.equal(reconnectEvents.length, 0);

    const state = await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A
    });
    assert.equal(state.status, 200);
    assert.equal(state.body.peer.name, 'Alice');
    assert.equal(state.body.peer.muted, true);
    assert.equal(state.body.peer.deafened, true);

    peerA2.ws.close();
    peerB.ws.close();
  } catch (error) {
    dumpServerLogs(serverLogs);
    throw error;
  }
});