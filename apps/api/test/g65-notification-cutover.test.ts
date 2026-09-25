import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { readMessageDeliveryMode } from '../src/lib/config.ts';
import type { NotificationOutboxRepository } from '../src/domains/notifications/notification-outbox-repository.ts';
import { createNotificationDeliveryWorker, main } from '../src/workers/notification-delivery.ts';
import { fake, outboxEvent } from './fakes/index.ts';

test('G65-A02 the notification worker stays off until claims are enabled', async () => {
  // Without the flag main() returns before it touches the pool.
  await main({ LOG_LEVEL: 'silent' }, fake<pg.Pool>());
});

test('G65-A02 ten provider failures stop claiming until the worker restarts', async () => {
  let claims = 0;
  const control: { stop?: () => void } = {};
  const outbox = fake<NotificationOutboxRepository>({
    async acquireLease() {
      return { acquired: true as const, fencingToken: 1, expiresAt: null };
    },
    async renewLease() {
      return { renewed: true };
    },
    async releaseLease() {},
    async recordHeartbeat(input) {
      if (input.ready === false) setImmediate(() => control.stop?.());
    },
    async oldestPendingAgeMs() {
      return 0;
    },
    async claimBatch() {
      claims += 1;
      return [outboxEvent({ eventId: `e${claims}`, payload: { body: 'hi' } })];
    },
    async loadCurrent() {
      return { level: 'all', reasons: [] };
    },
    async reschedule() {},
    async markDelivered() {},
    async markSuppressed() {}
  });
  const provider = {
    async deliver() {
      throw new Error('push service down');
    }
  };
  const worker = createNotificationDeliveryWorker({
    outbox,
    provider,
    idleMs: 1,
    leaseMs: 1000,
    renewMs: 100,
    logger: { info() {}, warn() {}, error() {} }
  });
  control.stop = () => void worker.stop();
  await worker.start();
  assert.equal(worker.disabledReason, 'provider_failure_threshold');
  assert.equal(claims, 10);
});

test('G65-A02 message direct emit and delivery claims cannot run together', () => {
  assert.throws(
    () => readMessageDeliveryMode({ MESSAGE_DIRECT_EMIT_ENABLED: 'true', MESSAGE_DELIVERY_CLAIM_ENABLED: 'true' }),
    /cannot both be enabled/
  );
});
