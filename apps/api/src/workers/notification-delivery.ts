import type pg from 'pg';
import { isArray, isRecord } from '@voice-room/shared/guards';
import { readNotificationDeliveryWorkerConfig } from '../app/config.ts';
import { epochMillis } from '../platform/epoch-millis.ts';
import { createPushSubscriptionRepository } from '../domains/notifications/push-subscription.repository.ts';
import { createNotificationOutboxRepository } from '../domains/notifications/notification-outbox.repository.ts';
import { createNotificationPushProvider } from '../domains/notifications/push-provider.ts';
import { createDeviceTokenRepository } from '../domains/notifications/device-token.repository.ts';
import { createNativePushService } from '../domains/notifications/native-push.service.ts';
import { createPushFanout, failedPushProviders } from '../domains/notifications/push-fanout.ts';
import { createPushService } from '../lib/push-service.ts';
import { createRuStorePushClient } from '../lib/rustore-push.ts';
import { boundedBackoff, createLeaseRuntime, delay } from '../platform/lease-runtime.ts';
import type { FenceGuard } from '../platform/lease-runtime.ts';
import type { NotificationOutboxRepository } from '../domains/notifications/notification-outbox.repository.ts';
import { recordNotificationOldestPending } from '../lib/metrics.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';

type WorkerLogger = {
  info?(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal?(...args: unknown[]): void;
};
type Provider = {
  deliver(job: { recipientUserId: string; payload: unknown }): Promise<{ suppressed?: boolean } | null | undefined>;
};

const LEASE_IDENTITY = 'notification-delivery.G63';
// A job only RuStore failed dead-letters after this many attempts, a minute or
// two of backoff, long before its age would stop the worker.
const NATIVE_ONLY_MAX_ATTEMPTS = 4;

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
  outbox: NotificationOutboxRepository;
  provider: Provider;
  batchSize?: number;
  leaseMs?: number;
  renewMs?: number;
  idleMs?: number;
  maxAttempts?: number;
  logger?: WorkerLogger;
  observeOldestPending?: (ageMs: unknown) => void;
}) {
  const store = outbox;
  const push = provider;
  let disabledReason = '';
  const outcomes: { at: number; ok: boolean }[] = [];
  function observe(ok: boolean) {
    const cutoff = Date.now() - 600000;
    outcomes.push({ at: Date.now(), ok });
    while ((outcomes[0]?.at ?? Infinity) < cutoff) outcomes.shift();
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
        await delay(idleMs, guard.signal);
        continue;
      }
      const jobs = await store.claimBatch({ ...lease, limit: batchSize, staleClaimMs: leaseMs });
      if (!jobs.length) {
        await delay(idleMs, guard.signal);
        continue;
      }
      for (const job of jobs) {
        guard.assertOwned();
        try {
          const ageMs = Date.now() - (epochMillis(job.createdAt) ?? Number.NaN);
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
          const reasons = isArray(current?.reasons) ? current.reasons : [];
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
          const payload = isRecord(job.payload) ? job.payload : {};
          const result = await push.deliver({
            ...job,
            payload: {
              ...payload,
              body: current.private_notifications ? 'Откройте VoiceRoom, чтобы посмотреть уведомление.' : payload.body
            }
          });
          guard.assertOwned();
          if (result?.suppressed) await store.markSuppressed(job.eventId, lease);
          else await store.markDelivered(job.eventId, lease);
          observe(true);
        } catch (error) {
          guard.assertOwned();
          // A recipient with only the Android app fails on every RuStore
          // outage; that must not stop delivery for everyone.
          const failed = failedPushProviders(error);
          const nativeOnly = failed.length > 0 && failed.every((name) => name === 'rustore');
          const attemptsAllowed = nativeOnly ? Math.min(maxAttempts, NATIVE_ONLY_MAX_ATTEMPTS) : maxAttempts;
          await store.reschedule(job.eventId, lease, {
            delayMs: boundedBackoff(job.attempts, { baseMs: 5000, maxMs: 3600000, jitter: 0.2 }),
            error,
            maxAttempts: attemptsAllowed
          });
          if (!nativeOnly) observe(false);
          logger.warn(
            {
              evt: LOG_EVENTS.NOTIFICATION_DELIVERY_FAILED,
              eventId: job.eventId,
              attempt: job.attempts,
              maxAttempts: attemptsAllowed,
              providers: failed,
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

/** The worker's push provider: Web Push and RuStore, each on when configured. */
function createNotificationDeliveryProvider({
  pool,
  env,
  config,
  fetch
}: {
  pool: pg.Pool;
  env: NodeJS.ProcessEnv;
  config: ReturnType<typeof readNotificationDeliveryWorkerConfig>;
  fetch?: typeof globalThis.fetch | undefined;
}) {
  const web = createPushService({ store: createPushSubscriptionRepository({ pool }), env });
  const deviceTokens = createDeviceTokenRepository({ pool });
  const native = createNativePushService({
    config: config.RUSTORE_PUSH,
    tokens: () => deviceTokens,
    client: createRuStorePushClient({ ...config.RUSTORE_PUSH, fetch }),
    minVersion: config.ANDROID_MIN_VERSION
  });
  return createNotificationPushProvider({ pushService: createPushFanout(() => [{ name: 'web', ...web }, native]) });
}

async function main(env: NodeJS.ProcessEnv, pool: pg.Pool): Promise<void> {
  const config = readNotificationDeliveryWorkerConfig(env);
  if (!config.CLAIM_ENABLED) {
    createLogger({ env, name: 'worker.notification-delivery' }).info(
      { evt: LOG_EVENTS.WORKER_DISABLED, worker: 'notification-delivery', reason: 'claims_disabled' },
      'notification delivery claims are disabled'
    );
    return;
  }
  const outbox = createNotificationOutboxRepository({ pool });
  const provider = createNotificationDeliveryProvider({ pool, env, config });
  const worker = createNotificationDeliveryWorker({
    outbox,
    provider,
    batchSize: config.BATCH_SIZE,
    leaseMs: config.LEASE_MS,
    renewMs: config.RENEW_MS,
    maxAttempts: config.MAX_ATTEMPTS
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping || (stopping = worker.stop());
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  try {
    await worker.start();
  } finally {
    await stop();
  }
}

export { LEASE_IDENTITY, createNotificationDeliveryProvider, createNotificationDeliveryWorker, main };
