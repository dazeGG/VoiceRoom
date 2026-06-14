'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');

function canListen() {
  const script = [
    "const net=require('node:net')",
    "const server=net.createServer()",
    "server.once('error',()=>process.exit(1))",
    "server.listen({host:'127.0.0.1',port:0},()=>server.close(()=>process.exit(0)))"
  ].join(';');
  const result = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore' });
  return result.status === 0;
}

const networkTest = canListen() ? test : test.skip;

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

function startServer(socketPath, dataDir, logs, envOverrides = {}) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      ROOM_DATA_DIR: dataDir,
      ROOM_IDLE_TTL_MS: '60000',
      SOCKET_PATH: socketPath,
      ...envOverrides
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
        path: pathname,
        method: 'POST',
        socketPath: port,
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


function openSse(socketPath, pathname) {
  const messages = [];
  const req = http.get({ path: pathname, socketPath }, (res) => {
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
    messages,
    req,
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

async function getJson(port, pathname) {
  const response = await new Promise((resolve, reject) => {
    http
      .get(
        {
          path: pathname,
          socketPath: port,
          headers: { Accept: 'application/json' }
        },
        resolve
      )
      .on('error', reject);
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

networkTest('room registry survives restart and preserves the static flag', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-state-'));
  const serverLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, dataDir, serverLogs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  try {
    await waitForHealthz(socketPath);

    const dynamicRoom = await postJson(socketPath, '/api/rooms', {});
    assert.equal(dynamicRoom.status, 201);
    assert.equal(dynamicRoom.body.isStatic, false);

    const staticRoom = await postJson(socketPath, '/api/rooms', { isStatic: true });
    assert.equal(staticRoom.status, 201);
    assert.equal(staticRoom.body.isStatic, true);

    const dynamicBeforeRestart = await getJson(socketPath, `/api/rooms/${dynamicRoom.body.roomId}`);
    assert.equal(dynamicBeforeRestart.status, 200);
    assert.equal(dynamicBeforeRestart.body.exists, true);
    assert.equal(dynamicBeforeRestart.body.isStatic, false);
    assert.equal(dynamicBeforeRestart.body.emptySince > 0, true);

    const createdAt = dynamicBeforeRestart.body.createdAt;
    const staticCreatedAt = staticRoom.body.createdAt;

    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));

    const restartLogs = { stdout: '', stderr: '' };
    const restarted = startServer(socketPath, dataDir, restartLogs);
    t.after(() => {
      restarted.kill('SIGTERM');
    });

    try {
      await waitForHealthz(socketPath);

      const dynamicAfterRestart = await getJson(socketPath, `/api/rooms/${dynamicRoom.body.roomId}`);
      assert.equal(dynamicAfterRestart.status, 200);
      assert.equal(dynamicAfterRestart.body.exists, true);
      assert.equal(dynamicAfterRestart.body.isStatic, false);
      assert.equal(dynamicAfterRestart.body.createdAt, createdAt);

      const staticAfterRestart = await getJson(socketPath, `/api/rooms/${staticRoom.body.roomId}`);
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


networkTest('static empty rooms count toward per-IP empty-room quota', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-state-'));
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, dataDir, logs, { MAX_EMPTY_ROOMS_PER_IP: '1' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  try {
    await waitForHealthz(socketPath);

    const staticRoom = await postJson(socketPath, '/api/rooms', { isStatic: true });
    assert.equal(staticRoom.status, 201);
    assert.equal(staticRoom.body.isStatic, true);

    const blocked = await postJson(socketPath, '/api/rooms', { isStatic: true });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many rooms waiting from this IP, reuse one or try later');
  } catch (error) {
    dumpServerLogs(logs);
    throw error;
  }
});


networkTest('active static rooms stay counted toward per-IP room creation quota', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-state-'));
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, dataDir, logs, { MAX_EMPTY_ROOMS_PER_IP: '1' });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  try {
    await waitForHealthz(socketPath);

    const staticRoom = await postJson(socketPath, '/api/rooms', { isStatic: true });
    assert.equal(staticRoom.status, 201);
    assert.equal(staticRoom.body.isStatic, true);

    const joined = openSse(
      socketPath,
      `/api/events?room=${encodeURIComponent(staticRoom.body.roomId)}&peer=${encodeURIComponent('peer-aaaa')}&token=${encodeURIComponent('token-aaaaaaaaaaaaaaaaaaaaaaaaaa')}&name=${encodeURIComponent('Alice')}`
    );
    t.after(() => joined.req.destroy());
    await joined.waitFor('hello');

    const blocked = await postJson(socketPath, '/api/rooms', { isStatic: true });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many rooms waiting from this IP, reuse one or try later');
  } catch (error) {
    dumpServerLogs(logs);
    throw error;
  }
});
