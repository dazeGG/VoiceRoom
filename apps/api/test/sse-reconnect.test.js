'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');

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

function eventsRequest(socketPath, { roomId, peerId, token, name }) {
  const params = new URLSearchParams({
    room: roomId,
    peer: peerId,
    token,
    name
  });
  return { path: `/api/events?${params}`, socketPath };
}

function openSse(socketPath, params) {
  const messages = [];
  const req = http.get(eventsRequest(socketPath, params), (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let splitAt = buffer.indexOf('\n\n');
      while (splitAt !== -1) {
        const frame = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        const dataLine = frame
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (dataLine) {
          messages.push(JSON.parse(dataLine.slice(6)));
        }
        splitAt = buffer.indexOf('\n\n');
      }
    });
  });

  return {
    req,
    messages,
    waitFor(type, timeoutMs = 3000) {
      const started = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = messages.find((message) => message.type === type);
          if (found) {
            resolve(found);
            return;
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`Timed out waiting for SSE message type: ${type}`));
            return;
          }
          setTimeout(check, 20);
        };
        check();
      });
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('SSE reconnect preserves presence and avoids spurious join/leave events', async (t) => {
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

    const peerA = openSse(socketPath, {
      roomId,
      peerId: PEER_A,
      token: TOKEN_A,
      name: 'Alice'
    });
    await peerA.waitFor('hello');

    const peerB = openSse(socketPath, {
      roomId,
      peerId: PEER_B,
      token: TOKEN_B,
      name: 'Bob'
    });
    await peerB.waitFor('hello');
    await wait(100);

    await postJson(socketPath, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      muted: true,
      deafened: true
    });
    await peerB.waitFor('peer-updated');
    const beforeReconnect = peerB.messages.length;

    const peerA2 = openSse(socketPath, {
      roomId,
      peerId: PEER_A,
      token: TOKEN_A,
      name: 'Evil'
    });
    await peerA2.waitFor('hello');
    peerA.req.destroy();
    await wait(150);

    const reconnectEvents = peerB.messages.slice(beforeReconnect);
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

    peerA2.req.destroy();
    peerB.req.destroy();
  } catch (error) {
    dumpServerLogs(serverLogs);
    throw error;
  }
});
