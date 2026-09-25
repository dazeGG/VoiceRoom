import { createDbPool } from '../lib/db.ts';
import { readEnvInt, readMessageDeliveryMode } from '../lib/config.ts';
import { createMessageOutboxRepository } from '../domains/messaging/message-outbox-repository.ts';
import { boundedBackoff, createLeaseRuntime } from '../platform/lease-runtime.ts';
import type { FenceGuard, LeaseRuntime } from '../platform/lease-runtime.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';

type MessageOutbox = ReturnType<typeof createMessageOutboxRepository>;
type Deliver = (
  payload: unknown,
  context: { eventId: string; fencingToken: number; signal: AbortSignal }
) => Promise<unknown>;
type WorkerLogger = {
  info?(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal?(...args: unknown[]): void;
};

const LEASE_IDENTITY = 'message-delivery.G38';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Worker stopped'));
  return new Promise<void>((resolve, reject) => {
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
  logger = createLogger({ name: 'worker.message-delivery' }),
  maxAttempts = 12,
  outbox,
  renewMs = 10_000,
  staleClaimMs = 60_000
}: {
  batchSize?: number;
  deliver?: Deliver;
  idleMs?: number;
  leaseMs?: number;
  logger?: WorkerLogger;
  maxAttempts?: number;
  outbox?: MessageOutbox;
  renewMs?: number;
  staleClaimMs?: number;
} = {}) {
  if (!outbox) throw new TypeError('Message delivery outbox repository is required');
  const store = outbox;
  const dispatch: Deliver =
    deliver || ((event) => store.publishPostgres(event as Parameters<MessageOutbox['publishPostgres']>[0]));
  if (typeof dispatch !== 'function') throw new TypeError('Message delivery adapter must be a function');

  let runtime: LeaseRuntime;
  const leaseAdapter = {
    acquire: (lease: Parameters<MessageOutbox['acquireLease']>[0]) => store.acquireLease(lease),
    release: (lease: Parameters<MessageOutbox['releaseLease']>[0]) => store.releaseLease(lease),
    renew: (lease: Parameters<MessageOutbox['renewLease']>[0]) => store.renewLease(lease)
  };

  async function processLease(guard: FenceGuard): Promise<void> {
    const lease = {
      identity: LEASE_IDENTITY,
      ownerId: guard.lease.ownerId,
      fencingToken: guard.lease.fencingToken
    };
    await store.recordHeartbeat({ ...lease, ready: true });

    while (guard.isOwned()) {
      guard.assertOwned();
      const events = await store.claimBatch({
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
          await store.markDelivered(event.eventId, lease);
        } catch (error) {
          guard.assertOwned();
          await store.reschedule(event.eventId, lease, {
            delayMs: boundedBackoff(event.attempts, {
              baseMs: 1_000,
              maxMs: 60 * 60 * 1_000,
              jitter: 0.2
            }),
            error,
            maxAttempts
          });
          logger.warn(
            {
              evt: LOG_EVENTS.MESSAGE_DELIVERY_FAILED,
              eventId: event.eventId,
              attempt: event.attempts,
              maxAttempts,
              err: error
            },
            'message delivery attempt failed'
          );
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
      void store.recordHeartbeat(heartbeat).catch((error: unknown) => {
        logger.warn(
          { evt: LOG_EVENTS.WORKER_HEARTBEAT_FAILED, worker: 'message-delivery', err: error },
          'unable to record the message delivery heartbeat'
        );
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

async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!readMessageDeliveryMode(env).claimEnabled) {
    createLogger({ env, name: 'worker.message-delivery' }).info(
      { evt: LOG_EVENTS.WORKER_DISABLED, worker: 'message-delivery', reason: 'claims_disabled' },
      'message delivery claims are disabled'
    );
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

  let stopPromise: Promise<void> | null = null;
  function stop(): Promise<void> {
    if (!stopPromise) {
      stopPromise = worker.stop().finally(() => pool.end());
    }
    return stopPromise;
  }
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });

  try {
    await worker.start();
  } finally {
    await stop();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    createLogger({ name: 'worker.message-delivery' }).fatal(
      { evt: LOG_EVENTS.WORKER_FAILED, worker: 'message-delivery', err: error },
      'message delivery worker failed'
    );
    process.exitCode = 1;
  });
}

export { LEASE_IDENTITY, createMessageDeliveryWorker, main };
