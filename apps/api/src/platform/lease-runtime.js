'use strict';

const crypto = require('node:crypto');

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
const DEFAULT_IDLE_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

class LeaseLostError extends Error {
  constructor(message = 'Fenced lease ownership was lost') {
    super(message);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Lease runtime stopped');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, ms));
    function finish() {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function boundedBackoff(attempt, {
  baseMs = DEFAULT_IDLE_MS,
  maxMs = DEFAULT_MAX_BACKOFF_MS,
  jitter = 0
} = {}) {
  const exponent = Math.max(0, Math.min(20, Number(attempt) || 0));
  const bounded = Math.min(Math.max(1, maxMs), Math.max(1, baseMs) * (2 ** exponent));
  const normalizedJitter = Math.max(0, Math.min(1, Number(jitter) || 0));
  if (!normalizedJitter) return bounded;
  const spread = bounded * normalizedJitter;
  return Math.max(1, Math.round(bounded - spread + (Math.random() * spread * 2)));
}

function createFenceGuard({ lease, signal }) {
  let lost = false;
  return Object.freeze({
    lease,
    signal,
    assertOwned() {
      if (lost || signal.aborted) throw new LeaseLostError();
      return lease.fencingToken;
    },
    isOwned() {
      return !lost && !signal.aborted;
    },
    markLost() {
      lost = true;
    }
  });
}

function normalizeLease(value, identity, ownerId) {
  if (!value || value.acquired === false) return null;
  const fencingToken = Number(value.fencingToken ?? value.fencing_token);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new TypeError('Lease adapter must return a positive integer fencingToken');
  }
  return Object.freeze({
    identity,
    ownerId,
    fencingToken,
    expiresAt: value.expiresAt ?? value.expires_at ?? null
  });
}

function createLeaseRuntime({
  acquire,
  identity,
  idleMs = DEFAULT_IDLE_MS,
  jitter = 0,
  leaseMs = DEFAULT_LEASE_MS,
  logger = console,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  onHeartbeat = () => {},
  ownerId = crypto.randomUUID(),
  release = async () => {},
  renew,
  renewMs = DEFAULT_RENEW_MS,
  run,
  sleep = delay
} = {}) {
  if (!identity || typeof identity !== 'string') throw new TypeError('Lease identity is required');
  if (typeof acquire !== 'function') throw new TypeError('Lease acquire adapter is required');
  if (typeof renew !== 'function') throw new TypeError('Lease renew adapter is required');
  if (typeof run !== 'function') throw new TypeError('Lease work callback is required');
  if (!(renewMs > 0 && renewMs < leaseMs)) throw new TypeError('renewMs must be positive and less than leaseMs');

  const runtimeController = new AbortController();
  let loopPromise = null;
  let active = null;

  async function holdLease(lease) {
    const workController = new AbortController();
    const forwardStop = () => workController.abort(abortError(runtimeController.signal));
    runtimeController.signal.addEventListener('abort', forwardStop, { once: true });
    const guard = createFenceGuard({ lease, signal: workController.signal });
    active = { guard, lease };

    const renewal = (async () => {
      try {
        while (!workController.signal.aborted) {
          await sleep(renewMs, workController.signal);
          guard.assertOwned();
          const result = await renew({
            fencingToken: lease.fencingToken,
            identity,
            leaseMs,
            ownerId,
            signal: workController.signal
          });
          if (!result || result.renewed === false) throw new LeaseLostError();
          onHeartbeat({ identity, ownerId, fencingToken: lease.fencingToken, ready: true });
        }
      } catch (error) {
        if (!workController.signal.aborted) {
          guard.markLost();
          workController.abort(error instanceof LeaseLostError ? error : new LeaseLostError());
        }
      }
    })();

    try {
      await run(guard);
      guard.assertOwned();
    } finally {
      workController.abort();
      await renewal.catch(() => {});
      runtimeController.signal.removeEventListener('abort', forwardStop);
      active = null;
      onHeartbeat({ identity, ownerId, fencingToken: lease.fencingToken, ready: false });
      await release({
        fencingToken: lease.fencingToken,
        identity,
        ownerId
      }).catch((error) => logger.warn?.('Unable to release fenced lease:', error));
    }
  }

  async function loop() {
    let failures = 0;
    while (!runtimeController.signal.aborted) {
      try {
        const lease = normalizeLease(await acquire({
          identity,
          leaseMs,
          ownerId,
          signal: runtimeController.signal
        }), identity, ownerId);
        if (!lease) {
          await sleep(boundedBackoff(failures, { baseMs: idleMs, maxMs: maxBackoffMs, jitter }), runtimeController.signal);
          failures = Math.min(failures + 1, 20);
          continue;
        }
        failures = 0;
        await holdLease(lease);
      } catch (error) {
        if (runtimeController.signal.aborted) break;
        if (!(error instanceof LeaseLostError)) logger.error?.('Fenced lease iteration failed:', error);
        failures = Math.min(failures + 1, 20);
        await sleep(boundedBackoff(failures, { baseMs: idleMs, maxMs: maxBackoffMs, jitter }), runtimeController.signal)
          .catch(() => {});
      }
    }
  }

  return Object.freeze({
    identity,
    ownerId,
    get activeLease() {
      return active?.lease || null;
    },
    start() {
      if (!loopPromise) loopPromise = loop().finally(() => { loopPromise = null; });
      return loopPromise;
    },
    async stop() {
      runtimeController.abort();
      active?.guard.markLost();
      await loopPromise?.catch(() => {});
    }
  });
}

module.exports = {
  LeaseLostError,
  boundedBackoff,
  createLeaseRuntime
};
