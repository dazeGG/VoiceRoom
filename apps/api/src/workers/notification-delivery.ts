import { createDbPool } from '../lib/db.ts';
import { readEnvBool, readEnvInt } from '../lib/config.ts';
import { createPushStore } from '../lib/push-store.ts';
import { createNotificationOutboxRepository } from '../domains/notifications/notification-outbox-repository.ts';
import { createNotificationPushProvider } from '../domains/notifications/push-provider.ts';
import { boundedBackoff, createLeaseRuntime } from '../platform/lease-runtime.ts';
import type { FenceGuard } from '../platform/lease-runtime.ts';
import type { NotificationOutboxRepository } from '../domains/notifications/notification-outbox-repository.ts';
import { recordNotificationOldestPending } from '../lib/metrics.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';

type WorkerLogger = {
  info?(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal?(...args: unknown[]): void;
};
type Provider = { deliver(job: any): Promise<{ suppressed?: boolean } | null | undefined> };

const LEASE_IDENTITY = 'notification-delivery.G63';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function createNotificationDeliveryWorker({
  outbox,
  provider,
  batchSize = 50,
  leaseMs = 120000,
  renewMs = 30000,
  idleMs = 250,
  maxAttempts = 8,
  logger = createLogger({ name: 'worker.notification-delivery' }),
  observeOldestPending = recordNotificationOldestPending
}: {
  outbox?: NotificationOutboxRepository;
  provider?: Provider;
  batchSize?: number;
  leaseMs?: number;
  renewMs?: number;
  idleMs?: number;
  maxAttempts?: number;
  logger?: WorkerLogger;
  observeOldestPending?: (ageMs: unknown) => void;
} = {}) {
  if (!outbox || !provider) throw new TypeError('Notification outbox and provider are required');
  const store = outbox;
  const push = provider;
  let disabledReason = '';
  const outcomes: { at: number; ok: boolean }[] = [];
  function observe(ok: boolean) {
    const cutoff = Date.now() - 600000;
    outcomes.push({ at: Date.now(), ok });
    while ((outcomes[0]?.at as number) < cutoff) outcomes.shift();
    const failures = outcomes.filter((item) => !item.ok).length;
    if (failures >= 10 || (outcomes.length >= 100 && failures / outcomes.length > 0.05))
      disabledReason = 'provider_failure_threshold';
  }
  async function processLease(guard: FenceGuard) {
    const lease = { identity: LEASE_IDENTITY, ownerId: guard.lease.ownerId, fencingToken: guard.lease.fencingToken };
    await store.recordHeartbeat({ ...lease, ready: true });
    while (guard.isOwned()) {
      guard.assertOwned();
      observeOldestPending(await store.oldestPendingAgeMs());
      if (disabledReason) {
        await store.recordHeartbeat({ ...lease, ready: false });
        await wait(idleMs, guard.signal);
        continue;
      }
      const jobs = await store.claimBatch({ ...lease, limit: batchSize, staleClaimMs: leaseMs });
      if (!jobs.length) {
        await wait(idleMs, guard.signal);
        continue;
      }
      for (const job of jobs) {
        guard.assertOwned();
        try {
          const ageMs = Date.now() - new Date(job.createdAt as string).getTime();
          if (ageMs > 15 * 60 * 1000) {
            disabledReason = 'oldest_pending_exceeded';
            await store.reschedule(job.eventId, lease, {
              delayMs: 60000,
              error: new Error(disabledReason),
              maxAttempts
            });
            continue;
          }
          if (ageMs > 5 * 60 * 1000)
            logger.warn(
              { evt: LOG_EVENTS.NOTIFICATION_BACKLOG_AGED, eventId: job.eventId, ageMs },
              'notification outbox age exceeds five minutes'
            );
          const current = await store.loadCurrent(job);
          const reasons = (current?.reasons as string[] | undefined) || [];
          const addressed = reasons.includes('mention') || reasons.includes('reply');
          const suppressed =
            !current ||
            current.retracted_at ||
            current.dnd ||
            current.level === 'none' ||
            (current.level === 'mentions' && !addressed);
          if (suppressed) {
            await store.markSuppressed(job.eventId, lease);
            observe(true);
            continue;
          }
          const result = await push.deliver({
            ...job,
            payload: {
              ...(job.payload as Record<string, any>),
              body: current!.private_notifications
                ? 'Откройте VoiceRoom, чтобы посмотреть уведомление.'
                : (job.payload as Record<string, any> | null)?.body
            }
          });
          guard.assertOwned();
          if (result?.suppressed) await store.markSuppressed(job.eventId, lease);
          else await store.markDelivered(job.eventId, lease);
          observe(true);
        } catch (error) {
          guard.assertOwned();
          await store.reschedule(job.eventId, lease, {
            delayMs: boundedBackoff(job.attempts, { baseMs: 5000, maxMs: 3600000, jitter: 0.2 }),
            error,
            maxAttempts
          });
          observe(false);
          logger.warn(
            {
              evt: LOG_EVENTS.NOTIFICATION_DELIVERY_FAILED,
              eventId: job.eventId,
              attempt: job.attempts,
              maxAttempts,
              err: error
            },
            'notification delivery attempt failed'
          );
        }
      }
    }
  }
  const runtime = createLeaseRuntime({
    identity: LEASE_IDENTITY,
    leaseMs,
    renewMs,
    idleMs,
    logger,
    acquire: (x) => store.acquireLease(x),
    renew: (x) => store.renewLease(x),
    release: (x) => store.releaseLease(x),
    run: processLease,
    onHeartbeat: (x) => {
      void store.recordHeartbeat(x).catch(() => {});
    }
  });
  return Object.freeze({
    identity: LEASE_IDENTITY,
    get activeLease() {
      return runtime.activeLease;
    },
    get disabledReason() {
      return disabledReason;
    },
    start: () => runtime.start(),
    stop: () => runtime.stop()
  });
}

async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!readEnvBool('NOTIFICATION_DELIVERY_CLAIM_ENABLED', false, env)) {
    createLogger({ env, name: 'worker.notification-delivery' }).info(
      { evt: LOG_EVENTS.WORKER_DISABLED, worker: 'notification-delivery', reason: 'claims_disabled' },
      'notification delivery claims are disabled'
    );
    return;
  }
  const pool = createDbPool();
  const outbox = createNotificationOutboxRepository({ pool });
  const store = createPushStore({ pool });
  const provider = createNotificationPushProvider({ store, env });
  const worker = createNotificationDeliveryWorker({
    outbox,
    provider,
    batchSize: readEnvInt('NOTIFICATION_DELIVERY_BATCH_SIZE', 50, 1, env),
    leaseMs: readEnvInt('NOTIFICATION_DELIVERY_LEASE_MS', 120000, 1000, env),
    renewMs: readEnvInt('NOTIFICATION_DELIVERY_RENEW_MS', 30000, 100, env),
    maxAttempts: readEnvInt('NOTIFICATION_DELIVERY_MAX_ATTEMPTS', 8, 1, env)
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping || (stopping = worker.stop().finally(() => pool.end()));
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  try {
    await worker.start();
  } finally {
    await stop();
  }
}

if (import.meta.main)
  main().catch((error: unknown) => {
    createLogger({ name: 'worker.notification-delivery' }).fatal(
      { evt: LOG_EVENTS.WORKER_FAILED, worker: 'notification-delivery', err: error },
      'notification delivery worker failed'
    );
    process.exitCode = 1;
  });
export { LEASE_IDENTITY, createNotificationDeliveryWorker, main };
