'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { createTestDatabase } = require('./db-harness');

const ROOM_ID = 'chat-room1';
const PEER_ID = 'peer-chat1';
const TOKEN = 'c'.repeat(32);


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

function startServer(socketPath, databaseUrl, logs, envOverrides = {}) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CHAT_TTL_MS: '60000',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      DATABASE_URL: databaseUrl,
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

async function postJson(socketPath, pathname, body, { cookie } = {}) {
  const payload = JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        path: pathname,
        method: 'POST',
        socketPath,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(cookie ? { Cookie: cookie } : {})
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
    body: text ? JSON.parse(text) : null,
    setCookie: response.headers['set-cookie']?.[0]?.split(';')[0] || ''
  };
}

async function getJson(socketPath, pathname) {
  const response = await new Promise((resolve, reject) => {
    http
      .get(
        {
          path: pathname,
          socketPath,
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
    body: text ? JSON.parse(text) : null,
    setCookie: response.headers['set-cookie']?.[0]?.split(';')[0] || ''
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

test('chat API persists, streams, and respects room auth', async (t) => {
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

    const join = openSse(
      socketPath,
      `/api/events?room=${encodeURIComponent(created.body.roomId)}&peer=${encodeURIComponent(PEER_ID)}&token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent('Alice')}`
    );
    await join.waitFor('hello');

    const empty = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.messages, []);

    const stream = openSse(socketPath, `/api/rooms/${created.body.roomId}/chat/stream`);
    const posted = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Alice',
      peerId: PEER_ID,
      sessionToken: TOKEN,
      text: 'Привет, чат!'
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.message.text, 'Привет, чат!');

    const streamed = await stream.waitFor('chat-message');
    assert.equal(streamed.message.text, 'Привет, чат!');

    const after = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`);
    assert.equal(after.status, 200);
    assert.equal(after.body.messages.length, 1);
    assert.equal(after.body.messages[0].text, 'Привет, чат!');

    join.req.destroy();
    stream.req.destroy();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});


test('chat API allows posting by room link without joining voice', async (t) => {
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

    const created = await postJson(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(created.status, 201);

    const stream = openSse(socketPath, `/api/rooms/${created.body.roomId}/chat/stream`);
    const posted = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Link Guest',
      text: 'Пишу без входа в голос'
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.message.name, 'Link Guest');
    assert.equal(posted.body.message.text, 'Пишу без входа в голос');
    assert.match(posted.body.message.peerId, /^chat-[a-f0-9]{24}$/);

    const streamed = await stream.waitFor('chat-message');
    assert.equal(streamed.message.id, posted.body.message.id);
    assert.equal(streamed.message.text, 'Пишу без входа в голос');

    const after = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`);
    assert.equal(after.status, 200);
    assert.equal(after.body.messages.length, 1);
    assert.equal(after.body.messages[0].id, posted.body.message.id);

    stream.req.destroy();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API returns not found when posting to a missing room', async (t) => {
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

    const posted = await postJson(socketPath, '/api/rooms/missing-room1/chat', {
      name: 'Link Guest',
      text: 'hello?'
    });
    assert.equal(posted.status, 404);
    assert.equal(posted.body.error, 'Room not found');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});

test('chat API still protects active voice peer identities', async (t) => {
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

    const join = openSse(
      socketPath,
      `/api/events?room=${encodeURIComponent(created.body.roomId)}&peer=${encodeURIComponent(PEER_ID)}&token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent('Alice')}`
    );
    await join.waitFor('hello');

    const spoofed = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Mallory',
      peerId: PEER_ID,
      text: 'spoof'
    });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.body.error, 'Invalid peer session');

    const valid = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Alice',
      peerId: PEER_ID,
      sessionToken: TOKEN,
      text: 'valid'
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.message.peerId, PEER_ID);

    join.req.destroy();
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});


test('chat API rate limits room-link posts per room and IP', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, {
    ROOM_CHAT_RATE_LIMIT: '1',
    ROOM_CHAT_RATE_WINDOW_MS: '60000'
  });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const created = await postJson(socketPath, '/api/rooms', { isStatic: false });
    assert.equal(created.status, 201);

    const first = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Link Guest',
      text: 'first'
    });
    assert.equal(first.status, 201);

    const second = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Link Guest',
      text: 'second'
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'Too many chat messages');
    assert.equal(typeof second.body.retryAfterSeconds, 'number');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});


test('manual static-room chat scenario survives API restart without voice join', async (t) => {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
  let child = startServer(socketPath, databaseUrl, logs);
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });

  try {
    await waitForHealthz(socketPath);

    const registered = await postJson(socketPath, '/api/auth/register', {
      login: 'manual-owner',
      password: 'password123'
    });
    assert.equal(registered.status, 201);
    const sessionCookie = registered.setCookie;

    const created = await postJson(socketPath, '/api/rooms', { isStatic: true }, { cookie: sessionCookie });
    assert.equal(created.status, 201);
    assert.equal(created.body.isStatic, true);

    const statusBeforeRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}`);
    assert.equal(statusBeforeRestart.status, 200);
    assert.equal(statusBeforeRestart.body.exists, true);
    assert.equal(statusBeforeRestart.body.isStatic, true);

    const posted = await postJson(socketPath, `/api/rooms/${created.body.roomId}/chat`, {
      name: 'Manual Guest',
      text: 'Сообщение до перезапуска API'
    });
    assert.equal(posted.status, 201);
    assert.match(posted.body.message.peerId, /^chat-[a-f0-9]{24}$/);

    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));

    const restartLogs = { stdout: '', stderr: '' };
    child = startServer(socketPath, databaseUrl, restartLogs);
    await waitForHealthz(socketPath);

    const statusAfterRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}`);
    assert.equal(statusAfterRestart.status, 200);
    assert.equal(statusAfterRestart.body.exists, true);
    assert.equal(statusAfterRestart.body.isStatic, true);

    const chatAfterRestart = await getJson(socketPath, `/api/rooms/${created.body.roomId}/chat`);
    assert.equal(chatAfterRestart.status, 200);
    assert.equal(chatAfterRestart.body.messages.length, 1);
    assert.equal(chatAfterRestart.body.messages[0].id, posted.body.message.id);
    assert.equal(chatAfterRestart.body.messages[0].text, 'Сообщение до перезапуска API');
  } catch (error) {
    if (logs.stderr.trim()) {
      console.error('Server stderr:\n', logs.stderr.trimEnd());
    }
    throw error;
  }
});
