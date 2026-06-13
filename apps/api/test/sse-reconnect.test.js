'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PEER_A = 'peer-alice1';
const PEER_B = 'peer-bobbb1';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function waitForHealthz(port, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(`http://127.0.0.1:${port}/api/healthz`, (res) => {
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

function startServer(port, logs) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      MAX_EMPTY_ROOMS_PER_IP: '0'
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

async function postJson(port, pathname, body) {
  const payload = JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
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

function eventsUrl(port, { roomId, peerId, token, name }) {
  const params = new URLSearchParams({
    room: roomId,
    peer: peerId,
    token,
    name
  });
  return `http://127.0.0.1:${port}/api/events?${params}`;
}

function openSse(port, params) {
  const messages = [];
  const req = http.get(eventsUrl(port, params), (res) => {
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
  const port = await getFreePort();
  const serverLogs = { stdout: '', stderr: '' };
  const child = startServer(port, serverLogs);
  t.after(() => {
    child.kill('SIGTERM');
  });

  try {
    await waitForHealthz(port);

    const created = await postJson(port, '/api/rooms', {});
    assert.equal(created.status, 201);
    const roomId = created.body.roomId;

    const peerA = openSse(port, {
      roomId,
      peerId: PEER_A,
      token: TOKEN_A,
      name: 'Alice'
    });
    await peerA.waitFor('hello');

    const peerB = openSse(port, {
      roomId,
      peerId: PEER_B,
      token: TOKEN_B,
      name: 'Bob'
    });
    await peerB.waitFor('hello');
    await wait(100);

    await postJson(port, '/api/state', {
      roomId,
      peerId: PEER_A,
      sessionToken: TOKEN_A,
      muted: true,
      deafened: true
    });
    await peerB.waitFor('peer-updated');
    const beforeReconnect = peerB.messages.length;

    const peerA2 = openSse(port, {
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

    const state = await postJson(port, '/api/state', {
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
