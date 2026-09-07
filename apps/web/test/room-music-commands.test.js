// The room.music.* command wrappers in lib/api/realtime.ts.
//
// Every wrapper goes through `normalizeMusicCommand` from the shared contract
// rather than assembling a payload by hand, so this exercises the real module
// against a fake socket and asserts the frames that actually reach the wire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const sockets = [];

class TestWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = TestWebSocket.CONNECTING;
    this.frames = [];
    sockets.push(this);
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.onopen?.();
  }

  send(frame) {
    this.frames.push(JSON.parse(frame));
  }

  close() {
    this.readyState = TestWebSocket.CLOSED;
    this.onclose?.();
  }
}

globalThis.WebSocket = TestWebSocket;
globalThis.window = { location: { protocol: 'http:', host: 'voiceroom.test' } };

let sequence = 0;

async function loadRealtime() {
  const shared = await import('@voice-room/shared/room-music');
  globalThis.__roomMusicShared = shared;
  const stubUrl = moduleUrl(`
    export const harnessId = ${++sequence};
    export const normalizeMusicCommand = globalThis.__roomMusicShared.normalizeMusicCommand;
    export const isDesktopBoundaryBlocked = () => false;
    export class RealtimeHeartbeatWatchdog {
      constructor() {}
      isTimedOut() { return false; }
      recordPing() {}
      recordPong() {}
      reset() {}
    }
  `);
  const path = 'src/lib/api/realtime.ts';
  const source = readFileSync(resolve(root, path), 'utf8')
    .replace(/from '[^']+'/g, `from '${stubUrl}'`)
    .replace(/import\('[^']+'\)/g, `import('${stubUrl}')`);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  const realtime = await import(moduleUrl(output));
  // A frame sent before the socket opens is queued; opening flushes the queue,
  // which is where the assertions read it from.
  realtime.getAppRealtime().ensureConnected();
  const socket = sockets.at(-1);
  // Opening the socket starts a heartbeat interval; closing it clears the
  // timers, and with no subscribers there is no reconnect to schedule.
  return { realtime, socket, shared, close: () => socket.close() };
}

test('every music command reaches the wire in its shared-contract shape', async (t) => {
  const { realtime, socket, close } = await loadRealtime();
  t.after(close);

  assert.equal(realtime.enqueueRoomMusic('room-1', 'https://vkvideo.ru/video-1_77'), true);
  assert.equal(realtime.skipRoomMusic('room-1'), true);
  assert.equal(realtime.skipRoomMusic('room-1', 'item-9'), true);
  assert.equal(realtime.removeRoomMusicItem('room-1', 'item-9'), true);
  assert.equal(realtime.stopRoomMusic('room-1'), true);
  socket.open();

  const music = socket.frames.filter((frame) => frame.type.startsWith('room.music.'));
  assert.equal(music.length, 5);
  assert.equal(music[0].type, 'room.music.enqueue');
  assert.equal(music[0].payload.roomId, 'room-1');
  assert.equal(music[0].payload.trackRef.kind, 'video');
  assert.equal(music[0].payload.trackRef.id, 'vk:video:-1_77');
  // A link the server would have to re-parse is never what goes on the wire.
  assert.equal(music[0].payload.link, undefined);

  assert.deepEqual(music[1], { type: 'room.music.skip', payload: { roomId: 'room-1', itemId: null } });
  assert.deepEqual(music[2], { type: 'room.music.skip', payload: { roomId: 'room-1', itemId: 'item-9' } });
  assert.deepEqual(music[3], { type: 'room.music.remove', payload: { roomId: 'room-1', itemId: 'item-9' } });
  assert.deepEqual(music[4], { type: 'room.music.stop', payload: { roomId: 'room-1' } });
});

test('input the shared contract rejects never becomes a frame', async (t) => {
  const { realtime, socket, close } = await loadRealtime();
  t.after(close);

  assert.equal(realtime.enqueueRoomMusic('room-1', 'https://example.com/song'), false);
  assert.equal(realtime.enqueueRoomMusic('room-1', ''), false);
  assert.equal(realtime.removeRoomMusicItem('room-1', ''), false);
  // Room scoping is the server's job, but a wrapper with no room has nothing to
  // address and must not send.
  assert.equal(realtime.stopRoomMusic(''), false);
  assert.equal(realtime.enqueueRoomMusic('', 'https://vkvideo.ru/video-1_77'), false);
  socket.open();

  assert.deepEqual(socket.frames.filter((frame) => frame.type.startsWith('room.music.')), []);
});

test('playlist links from two sources keep their canonical dedup ids', async (t) => {
  const { realtime, socket, close } = await loadRealtime();
  t.after(close);

  realtime.enqueueRoomMusic('room-1', 'https://vkvideo.ru/playlist/-900_1');
  realtime.enqueueRoomMusic('room-1', 'https://rutube.ru/plst/1005/');
  socket.open();

  const music = socket.frames.filter((frame) => frame.type === 'room.music.enqueue');
  assert.equal(music.length, 2);
  assert.equal(music[0].payload.trackRef.id, 'vk:playlist:-900_1');
  assert.equal(music[1].payload.trackRef.id, 'rutube:playlist:1005');
});
