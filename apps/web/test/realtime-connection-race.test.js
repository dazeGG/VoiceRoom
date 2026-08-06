import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('eager ensureConnected cancels a scheduled reconnect and keeps one socket heartbeat', async () => {
  const stubUrl = moduleUrl(`
    export const isDesktopBoundaryBlocked = () => false;
    export class RealtimeHeartbeatWatchdog {
      isTimedOut() { return false; }
      recordPing() {}
      recordPong() {}
      reset() {}
    }
  `);
  const source = readFileSync(new URL('../src/lib/api/realtime.ts', import.meta.url), 'utf8')
    .replace(/from '[^']+'/g, `from '${stubUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true }
  }).outputText;

  const original = {
    WebSocket: globalThis.WebSocket,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout
  };
  const scheduled = [];
  const cleared = new Set();
  let intervals = 0;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances = [];
    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
      FakeWebSocket.instances.push(this);
    }
    close() { this.readyState = 3; }
    send() {}
  }

  globalThis.WebSocket = FakeWebSocket;
  globalThis.setTimeout = (callback) => {
    const id = scheduled.length + 1;
    scheduled.push({ callback, id });
    return id;
  };
  globalThis.clearTimeout = (id) => cleared.add(id);
  globalThis.setInterval = () => { intervals += 1; return intervals; };
  globalThis.clearInterval = () => {};

  try {
    const { getAppRealtime } = await import(moduleUrl(output));
    const connection = getAppRealtime();
    const unsubscribe = connection.subscribe(() => {});
    const first = FakeWebSocket.instances[0];
    first.readyState = 3;
    first.onclose();
    assert.equal(scheduled.length, 1);

    connection.ensureConnected();
    assert.equal(cleared.has(scheduled[0].id), true);
    assert.equal(FakeWebSocket.instances.length, 2);
    scheduled[0].callback();
    assert.equal(FakeWebSocket.instances.length, 2);

    const current = FakeWebSocket.instances[1];
    current.readyState = FakeWebSocket.OPEN;
    current.onopen();
    connection.ensureConnected();
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(intervals, 1);
    unsubscribe();
  } finally {
    Object.assign(globalThis, original);
  }
});
