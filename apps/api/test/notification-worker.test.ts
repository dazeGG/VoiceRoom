import assert from 'node:assert/strict';
import { Pool } from 'pg';
import test from 'node:test';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import {
  createNotificationOutboxRepository,
  type NotificationOutboxRepository
} from '../src/domains/notifications/notification-outbox.repository.ts';
import { fake, outboxEvent } from './fakes/index.ts';
import { createNotificationPushProvider } from '../src/domains/notifications/push-provider.ts';
import { createNotificationDeliveryWorker } from '../src/workers/notification-delivery.ts';
test(
  'G63-A01 only one worker owns the fenced lease and takeover increments the fence',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    await runMigrations({
      databaseUrl: db.databaseUrl,
      logger: { log() {}, info() {}, warn() {}, error() {} },
      noLock: true
    });
    const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
    t.after(async () => {
      await pool.end();
      await db.cleanup();
    });
    const repo = createNotificationOutboxRepository({ pool });
    const one = await repo.acquireLease({ identity: 'notification-delivery.G63', ownerId: 'one', leaseMs: 120000 });
    assert.ok(one.acquired);
    assert.equal(
      (await repo.acquireLease({ identity: 'notification-delivery.G63', ownerId: 'two', leaseMs: 120000 })).acquired,
      false
    );
    await repo.releaseLease({ identity: 'notification-delivery.G63', ownerId: 'one', fencingToken: one.fencingToken });
    const two = await repo.acquireLease({ identity: 'notification-delivery.G63', ownerId: 'two', leaseMs: 120000 });
    assert.ok(two.acquired);
    assert.ok(two.fencingToken > one.fencingToken);
  }
);
test('G63-A02 provider failures throw while terminal/no-subscription outcomes suppress', async () => {
  const failing = createNotificationPushProvider({
    pushService: {
      config: { enabled: true },
      async sendToUser(_u, _p, c) {
        assert.equal(c.strictFailures, true);
        throw new Error('503');
      }
    }
  });
  await assert.rejects(failing.deliver({ recipientUserId: 'u', payload: {} }), /503/);
  const terminal = createNotificationPushProvider({
    pushService: {
      config: { enabled: true },
      async sendToUser() {
        return { enabled: true, sent: 0, removed: 1 };
      }
    }
  });
  assert.equal((await terminal.deliver({ recipientUserId: 'u', payload: {} })).suppressed, true);
});
test('G63-A03 oldest pending age is read from storage on every interval including disabled claims', async () => {
  const control: { stop?: () => void } = {};
  let age = 0;
  let reads = 0;
  const outbox = fake<NotificationOutboxRepository>({
    async acquireLease() {
      return { acquired: true as const, fencingToken: 1, expiresAt: null };
    },
    async renewLease() {
      return { renewed: true };
    },
    async releaseLease() {},
    async recordHeartbeat() {},
    async oldestPendingAgeMs() {
      reads += 1;
      if (reads === 2) setImmediate(() => control.stop?.());
      return 16 * 60 * 1000;
    },
    async claimBatch() {
      return [outboxEvent({ eventId: 'old', createdAt: new Date(Date.now() - 16 * 60 * 1000) })];
    },
    async reschedule() {}
  });
  const worker = createNotificationDeliveryWorker({
    outbox,
    provider: {
      async deliver() {
        throw new Error('must not deliver');
      }
    },
    idleMs: 1,
    leaseMs: 1000,
    renewMs: 100,
    observeOldestPending(value) {
      age = Number(value);
    }
  });
  control.stop = () => void worker.stop();
  await worker.start();
  assert.equal(worker.disabledReason, 'oldest_pending_exceeded');
  assert.ok(age >= 15 * 60 * 1000);
  assert.ok(reads >= 2);
});
