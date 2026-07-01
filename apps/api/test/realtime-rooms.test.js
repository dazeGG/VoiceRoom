'use strict';

// Integration coverage for the WS room surface that the plan calls out:
//   - room.summary fan-out to visible/saved-room users with bounded visiblePeers
//     and an explicit hiddenPeerCount;
//   - preview subscribe delivers a snapshot then live peer diffs, and unsubscribe
//     stops those diffs;
//   - a connection that neither subscribed nor joined receives no room detail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const {
  openWs,
  sendWs,
  joinVoiceRoom,
  subscribeRoomPreview,
  waitForWsType,
  countWsType
} = require('./ws-harness');
const { createTestDatabase } = require('./db-harness');

function getSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-rt-'));
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

function requestJson(socketPath, { method = 'GET', pathname, body, cookie } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers = { Accept: 'application/json' };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null,
          setCookie: res.headers['set-cookie'] || []
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie) {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header || '').split(';')[0];
}

async function register(socketPath, login) {
  const response = await requestJson(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(response.status, 201);
  return { cookie: cookieFrom(response.setCookie), user: response.body.user };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function voiceCreds(index) {
  return {
    peerId: `peer-voice-${index}`,
    sessionToken: `vtoken${index}`.padEnd(32, '0'),
    name: `Peer ${index}`
  };
}

async function withServer(t) {
  const { dir, socketPath } = getSocketPath();
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs = { stdout: '', stderr: '' };
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
    const created = await requestJson(socketPath, {
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
      (frame) => frame.payload?.room?.roomId === roomId && frame.payload.room.peers === 6
    );
    const summary = full.payload.room;
    assert.equal(summary.peers, 6);
    assert.equal(summary.visiblePeers.length, 5, 'visiblePeers must be capped at 5');
    assert.equal(summary.hiddenPeerCount, 1, 'hiddenPeerCount must be peers - visiblePeers');
    assert.ok(summary.visiblePeers.every((peer) => typeof peer.id === 'string'));

    // One peer leaves; the owner sees the count drop.
    const sinceLeave = ownerWs.frames.length;
    peers[0].peer.ws.close();

    const afterLeave = await waitForWsType(
      ownerWs.frames,
      'room.summary',
      (frame) => frame.payload?.room?.roomId === roomId && frame.payload.room.peers === 5,
      5000
    );
    assert.ok(ownerWs.frames.indexOf(afterLeave) >= sinceLeave, 'summary must reflect the leave');
    assert.equal(afterLeave.payload.room.visiblePeers.length, 5);
    assert.equal(afterLeave.payload.room.hiddenPeerCount, 0);

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
    const created = await requestJson(socketPath, { method: 'POST', pathname: '/api/rooms', body: {} });
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
      (frame) => frame.payload?.roomId === roomId && frame.payload.peer?.id === first.peerId
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
    const created = await requestJson(socketPath, { method: 'POST', pathname: '/api/rooms', body: {} });
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
