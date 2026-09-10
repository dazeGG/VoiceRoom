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
const { openWs, joinVoiceRoom, sendWs, waitForWsType } = require('./ws-harness');

const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-sock-'));
  return {
    dir,
    socketPath: socketPathForDirectory(dir)
  };
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
      (frame) => frame.payload?.peer?.id === PEER_A,
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
      (frame) => frame.payload?.peer?.id === PEER_B && frame.payload.peer.viewedScreenPeerId === PEER_A,
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

    const reconnectEvents = peerB.frames.slice(beforeReconnect).filter((frame) =>
      frame.type === 'room.peer.joined' || frame.type === 'room.peer.left'
    );
    assert.equal(reconnectEvents.length, 0);

    const peerA3 = openWs(socketPath);
    await peerA3.ready;
    await joinVoiceRoom(peerA3, { roomId, peerId: PEER_A, sessionToken: TOKEN_A, name: 'Still Evil' });
    const beforeStaleLeave = peerB.frames.length;
    sendWs(peerA2.ws, 'room.leave', { roomId, peerId: PEER_A });
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

    const state = await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A
    });
    assert.equal(state.status, 200);
    assert.equal(state.body.peer.name, 'Alice');
    assert.equal(state.body.peer.muted, true);
    assert.equal(state.body.peer.deafened, true);
    assert.equal(state.body.peer.screen, true);

    const viewerState = await postJson(socketPath, '/api/state', {
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
