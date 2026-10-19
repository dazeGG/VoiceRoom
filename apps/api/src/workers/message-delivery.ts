import type pg from 'pg';
import { readMessageDeliveryWorkerConfig } from '../app/config.ts';
import { createMessageOutboxRepository } from '../domains/messaging/message-outbox.repository.ts';
import { boundedBackoff, createLeaseRuntime, delay } from '../platform/lease-runtime.ts';
import type { FenceGuard, LeaseRuntime } from '../platform/lease-runtime.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import { fieldOf } from '../platform/record.ts';

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
  // Without an adapter the event id is announced over Postgres NOTIFY.
  const dispatch: Deliver =
    deliver ||
    ((event) => {
      const eventId = fieldOf(event, 'eventId');
      return store.publishPostgres({ eventId: typeof eventId === 'string' ? eventId : '' });
    });
  if (typeof dispatch !== 'function') throw new TypeError('Message delivery adapter must be a function');

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
        await delay(idleMs, guard.signal);
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

  const runtime: LeaseRuntime = createLeaseRuntime({
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

async function main(env: NodeJS.ProcessEnv, pool: pg.Pool): Promise<void> {
  const config = readMessageDeliveryWorkerConfig(env);
  if (!config.CLAIM_ENABLED) {
    createLogger({ env, name: 'worker.message-delivery' }).info(
      { evt: LOG_EVENTS.WORKER_DISABLED, worker: 'message-delivery', reason: 'claims_disabled' },
      'message delivery claims are disabled'
    );
    return;
  }

  const outbox = createMessageOutboxRepository({ pool });
  const worker = createMessageDeliveryWorker({
    batchSize: config.BATCH_SIZE,
    idleMs: config.IDLE_MS,
    leaseMs: config.LEASE_MS,
    maxAttempts: config.MAX_ATTEMPTS,
    outbox,
    renewMs: config.RENEW_MS,
    staleClaimMs: config.STALE_CLAIM_MS
  });

  let stopPromise: Promise<void> | null = null;
  function stop(): Promise<void> {
    if (!stopPromise) {
      stopPromise = worker.stop();
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

export { LEASE_IDENTITY, createMessageDeliveryWorker, main };
