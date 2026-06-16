'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startApiListener } = require('../src/lib/listen');

class FakeServer {
  constructor({ socketError = null, tcpAddress = { address: '127.0.0.1', port: 4321 } } = {}) {
    this.calls = [];
    this.listeners = new Map();
    this.socketError = socketError;
    this.tcpAddress = tcpAddress;
    this.currentAddress = null;
  }

  once(event, handler) {
    this.listeners.set(event, handler);
  }

  removeListener(event, handler) {
    if (this.listeners.get(event) === handler) {
      this.listeners.delete(event);
    }
  }

  listen(...args) {
    this.calls.push(args);
    if (typeof args[0] === 'string') {
      this.currentAddress = args[0];
      if (this.socketError) {
        const handler = this.listeners.get('error');
        if (handler) handler(this.socketError);
        return;
      }
      const callback = args[1];
      if (typeof callback === 'function') callback();
      return;
    }

    const [, , callback] = args;
    this.currentAddress = this.tcpAddress;
    if (typeof callback === 'function') callback();
  }

  address() {
    return this.currentAddress === null ? this.tcpAddress : this.currentAddress;
  }
}

function createLogger() {
  const messages = [];
  return {
    messages,
    error: (...args) => messages.push(['error', ...args]),
    log: (...args) => messages.push(['log', ...args]),
    warn: (...args) => messages.push(['warn', ...args])
  };
}

test('startApiListener falls back from unix socket to tcp and logs the actual tcp address', () => {
  const server = new FakeServer({
    socketError: Object.assign(new Error('EPERM'), { code: 'EPERM' }),
    tcpAddress: { address: '127.0.0.1', port: 4321 }
  });
  const logger = createLogger();
  let exitCode = null;

  startApiListener({
    exit: (code) => {
      exitCode = code;
    },
    host: '0.0.0.0',
    logger,
    port: 3000,
    server,
    socketPath: '/tmp/voice-room.sock'
  });

  assert.equal(exitCode, null);
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[0][0], '/tmp/voice-room.sock');
  assert.equal(typeof server.calls[0][1], 'function');
  assert.equal(server.calls[1][0], 3000);
  assert.equal(server.calls[1][1], '0.0.0.0');
  assert.equal(typeof server.calls[1][2], 'function');
  assert.deepEqual(logger.messages, [
    ['warn', 'Unable to bind unix socket at /tmp/voice-room.sock: EPERM'],
    ['warn', 'Falling back to TCP listen on 0.0.0.0:3000'],
    ['log', 'Voice Room API is listening on http://127.0.0.1:4321']
  ]);
});

test('startApiListener reports a direct tcp listen with the actual server address', () => {
  const server = new FakeServer({ tcpAddress: { address: '127.0.0.1', port: 3000 } });
  const logger = createLogger();

  startApiListener({
    exit: () => {
      throw new Error('exit should not be called');
    },
    host: '127.0.0.1',
    logger,
    port: 3000,
    server,
    socketPath: ''
  });

  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0][0], 3000);
  assert.equal(server.calls[0][1], '127.0.0.1');
  assert.equal(typeof server.calls[0][2], 'function');
  assert.deepEqual(logger.messages, [['log', 'Voice Room API is listening on http://127.0.0.1:3000']]);
});


test('startApiListener recovers a stale unix socket path once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-listen-'));
  const socketPath = path.join(dir, 'api.sock');
  fs.writeFileSync(socketPath, 'stale');

  const server = new FakeServer({
    socketError: Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' })
  });
  const logger = createLogger();
  let exitCode = null;
  let firstSocketAttempt = true;
  const originalListen = server.listen.bind(server);
  server.listen = (...args) => {
    if (typeof args[0] === 'string' && firstSocketAttempt) {
      firstSocketAttempt = false;
      originalListen(...args);
      server.socketError = null;
      return;
    }
    originalListen(...args);
  };

  try {
    startApiListener({
      exit: (code) => {
        exitCode = code;
      },
      logger,
      server,
      socketPath
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(exitCode, null);
    assert.equal(server.calls.length, 2);
    assert.equal(server.calls[0][0], socketPath);
    assert.equal(server.calls[1][0], socketPath);
    assert.equal(fs.existsSync(socketPath), false);
    assert.deepEqual(logger.messages, [['log', `Voice Room API is listening on unix://${socketPath}`]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
