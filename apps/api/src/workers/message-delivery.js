'use strict';

const { createDbPool } = require('../lib/db');
const { readEnvInt, readMessageDeliveryMode } = require('../lib/config');
const { createMessageOutboxRepository } = require('../domains/messaging/message-outbox-repository');
const { boundedBackoff, createLeaseRuntime } = require('../platform/lease-runtime');

const LEASE_IDENTITY = 'message-delivery.G38';

function wait(ms, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Worker stopped'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason || new Error('Worker stopped'));
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function createMessageDeliveryWorker({
  batchSize = 100,
  deliver,
  idleMs = 250,
  leaseMs = 30_000,
  logger = console,
  maxAttempts = 12,
  outbox,
  renewMs = 10_000,
  staleClaimMs = 60_000
} = {}) {
  if (!outbox) throw new TypeError('Message delivery outbox repository is required');
  const dispatch = deliver || ((event) => outbox.publishPostgres(event));
  if (typeof dispatch !== 'function') throw new TypeError('Message delivery adapter must be a function');

  let runtime;
  const leaseAdapter = {
    acquire: (lease) => outbox.acquireLease(lease),
    release: (lease) => outbox.releaseLease(lease),
    renew: (lease) => outbox.renewLease(lease)
  };

  async function processLease(guard) {
    const lease = {
      identity: LEASE_IDENTITY,
      ownerId: guard.lease.ownerId,
      fencingToken: guard.lease.fencingToken
    };
    await outbox.recordHeartbeat({ ...lease, ready: true });

    while (guard.isOwned()) {
      guard.assertOwned();
      const events = await outbox.claimBatch({
        ...lease,
        limit: batchSize,
        staleClaimMs
      });

      if (!events.length) {
        await wait(idleMs, guard.signal);
        continue;
      }

      for (const event of events) {
        guard.assertOwned();
        try {
          await dispatch(event.payload, {
            eventId: event.eventId,
            fencingToken: lease.fencingToken,
            signal: guard.signal
          });
          guard.assertOwned();
          await outbox.markDelivered(event.eventId, lease);
        } catch (error) {
          guard.assertOwned();
          await outbox.reschedule(event.eventId, lease, {
            delayMs: boundedBackoff(event.attempts, {
              baseMs: 1_000,
              maxMs: 60 * 60 * 1_000,
              jitter: 0.2
            }),
            error,
            maxAttempts
          });
          logger.warn?.(`Message delivery ${event.eventId} failed:`, error);
        }
      }
    }
  }

  runtime = createLeaseRuntime({
    ...leaseAdapter,
    identity: LEASE_IDENTITY,
    idleMs,
    leaseMs,
    logger,
    renewMs,
    run: processLease,
    onHeartbeat(heartbeat) {
      void outbox.recordHeartbeat(heartbeat).catch((error) => {
        logger.warn?.('Unable to record message delivery heartbeat:', error);
      });
    }
  });

  return Object.freeze({
    identity: LEASE_IDENTITY,
    get activeLease() {
      return runtime.activeLease;
    },
    start: () => runtime.start(),
    stop: () => runtime.stop()
  });
}

async function main(env = process.env) {
  if (!readMessageDeliveryMode(env).claimEnabled) {
    console.log('Message delivery claims are disabled');
    return;
  }

  const pool = createDbPool();
  const outbox = createMessageOutboxRepository({ pool });
  const worker = createMessageDeliveryWorker({
    batchSize: readEnvInt('MESSAGE_DELIVERY_BATCH_SIZE', 100, 1, env),
    idleMs: readEnvInt('MESSAGE_DELIVERY_IDLE_MS', 250, 10, env),
    leaseMs: readEnvInt('MESSAGE_DELIVERY_LEASE_MS', 30_000, 1_000, env),
    maxAttempts: readEnvInt('MESSAGE_DELIVERY_MAX_ATTEMPTS', 12, 1, env),
    outbox,
    renewMs: readEnvInt('MESSAGE_DELIVERY_RENEW_MS', 10_000, 100, env),
    staleClaimMs: readEnvInt('MESSAGE_DELIVERY_STALE_CLAIM_MS', 60_000, 1_000, env)
  });

  let stopPromise = null;
  function stop() {
    if (!stopPromise) {
      stopPromise = worker.stop().finally(() => pool.end());
    }
    return stopPromise;
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });

  try {
    await worker.start();
  } finally {
    await stop();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Message delivery worker failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  LEASE_IDENTITY,
  createMessageDeliveryWorker,
  main
};
