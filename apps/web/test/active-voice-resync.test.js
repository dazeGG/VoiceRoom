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

async function loadRoomRealtime() {
  const stubUrl = moduleUrl(`
    export const sent = [];
    export const connection = {
      epoch: 7,
      connected: true,
      ensureConnected() {},
      getConnectionEpoch() { return this.epoch; },
      isConnected() { return this.connected; },
      onRestore() { return () => {}; },
      send(type, payload, id) { sent.push({ type, payload, id }); },
      subscribe() { return () => {}; }
    };
    export const getAppRealtime = () => connection;
    export const applyRoomSummary = () => {};
  `);
  const path = 'src/lib/features/home/model/room-realtime.ts';
  const source = readFileSync(resolve(root, path), 'utf8')
    .replace(/from '[^']+'/g, `from '${stubUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  const stub = await import(stubUrl);
  return { realtime: await import(moduleUrl(output)), sent: stub.sent };
}

test('a delayed retryable error cannot cancel a newer successful voice resync attempt', async () => {
  const timers = new Map();
  let nextTimerId = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback) => {
    const id = ++nextTimerId;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);

  try {
    const { realtime, sent } = await loadRoomRealtime();
    const failures = [];
    realtime.setActiveVoiceResyncFailureHandler((failure) => failures.push(failure));
    realtime.joinVoiceRoom({
      roomId: 'room-resync',
      peerId: 'peer-resync',
      sessionToken: 'r'.repeat(32),
      name: 'Retry peer'
    });

    assert.equal(realtime.requestActiveVoiceResync(1, 7), true);
    const firstRequestId = sent.at(-1).id;
    const [firstTimerId, firstTimer] = timers.entries().next().value;
    timers.delete(firstTimerId);
    firstTimer();
    const secondRequestId = sent.at(-1).id;

    assert.notEqual(firstRequestId, secondRequestId);
    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'error',
        payload: { code: 'reconnect_finalize_failed', id: firstRequestId }
      }),
      true
    );
    assert.deepEqual(failures, []);
    assert.equal(sent.filter((entry) => entry.id).length, 2);

    assert.equal(
      realtime.acknowledgeActiveVoiceResync({
        type: 'room.snapshot',
        id: secondRequestId,
        payload: { mode: 'active', roomId: 'room-resync' }
      }),
      true
    );
    assert.deepEqual(failures, []);
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
