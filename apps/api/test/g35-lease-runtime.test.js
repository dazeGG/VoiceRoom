'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LeaseLostError, boundedBackoff, createLeaseRuntime } = require('../src/platform/lease-runtime');

test('G35-A01 backoff is deterministic and bounded when jitter is disabled', () => {
  assert.deepEqual([0, 1, 2, 20].map((attempt) => boundedBackoff(attempt, { baseMs: 10, maxMs: 25 })), [10, 20, 25, 25]);
});

test('G35-A02 renewal loss aborts work before a guarded side effect', async () => {
  const entered = Promise.withResolvers(); const lost = Promise.withResolvers();
  let acquireCount = 0;
  let sleepCount = 0;
  const runtime = createLeaseRuntime({
    identity: 'test.G35', ownerId: 'worker-a', leaseMs: 100, renewMs: 10, idleMs: 1,
    acquire: async () => acquireCount++ === 0 ? { acquired: true, fencingToken: 1 } : { acquired: false },
    renew: async () => ({ renewed: false }), release: async () => {},
    sleep: async (_ms, signal) => {
      sleepCount += 1;
      if (sleepCount === 1) return;
      if (signal.aborted) throw signal.reason;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    run: async (guard) => {
      entered.resolve();
      await new Promise((resolve) => guard.signal.addEventListener('abort', resolve, { once: true }));
      try { guard.assertOwned(); } catch (error) { lost.resolve(error); }
    },
    logger: { error() {}, warn() {} }
  });
  void runtime.start();
  const error = await lost.promise;
  assert.ok(error instanceof LeaseLostError);
  await runtime.stop();
});
