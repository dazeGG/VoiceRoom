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
import {
  createNotificationDeliveryProvider,
  createNotificationDeliveryWorker
} from '../src/workers/notification-delivery.ts';
import { readNotificationDeliveryWorkerConfig } from '../src/app/config.ts';
import { createDeviceTokenRepository } from '../src/domains/notifications/device-token.repository.ts';
import { createPushFanout, type PushSender } from '../src/domains/notifications/push-fanout.ts';
import { createNativePushService } from '../src/domains/notifications/native-push.service.ts';
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

// --- RuStore next to Web Push (decision 5a) -------------------------------------------

// A mention job the worker will try to deliver: nothing suppresses it.
const DELIVERABLE = {
  reasons: ['mention'],
  level: 'all',
  dnd: false,
  retracted_at: null,
  private_notifications: false
};

// Runs one batch of `count` jobs through `provider` and records each reschedule.
async function runBatch(provider: ReturnType<typeof createNotificationPushProvider>, count: number) {
  const control: { stop?: () => void } = {};
  const rescheduled: Array<{ eventId: string; maxAttempts: number | undefined }> = [];
  let claimed = false;
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
      return 0;
    },
    async claimBatch() {
      if (claimed) return [];
      claimed = true;
      return Array.from({ length: count }, (_, index) => outboxEvent({ eventId: `event-${index}` }));
    },
    async loadCurrent() {
      return DELIVERABLE;
    },
    async reschedule(eventId, _lease, { maxAttempts }) {
      rescheduled.push({ eventId, maxAttempts });
      // A disabled worker claims nothing more, so the test stops it after the batch.
      if (rescheduled.length === count) setImmediate(() => control.stop?.());
    }
  });
  const worker = createNotificationDeliveryWorker({
    outbox,
    provider,
    idleMs: 1,
    leaseMs: 1000,
    renewMs: 100,
    logger: { warn() {}, error() {} },
    observeOldestPending() {}
  });
  control.stop = () => void worker.stop();
  await worker.start();
  return { rescheduled, disabledReason: worker.disabledReason };
}

function fanoutProvider(web: PushSender['sendToUser'], rustore: PushSender['sendToUser']) {
  return createNotificationPushProvider({
    pushService: createPushFanout(() => [
      { name: 'web', config: { enabled: true }, sendToUser: web },
      { name: 'rustore', config: { enabled: true }, sendToUser: rustore }
    ])
  });
}

const NOTHING_SENT = async () => ({ enabled: true, sent: 0, removed: 0 });
const FAILS = async (): Promise<never> => {
  throw new Error('provider unavailable');
};

test('RuStore-only failures retry at most 4 times and never stop the worker', async () => {
  const { rescheduled, disabledReason } = await runBatch(fanoutProvider(NOTHING_SENT, FAILS), 10);
  assert.equal(disabledReason, '');
  assert.equal(rescheduled.length, 10);
  assert.ok(rescheduled.every((call) => call.maxAttempts === 4));
});

test('Web Push failures still count toward the failure threshold', async () => {
  const { rescheduled, disabledReason } = await runBatch(fanoutProvider(FAILS, NOTHING_SENT), 10);
  assert.equal(disabledReason, 'provider_failure_threshold');
  assert.equal(rescheduled.length, 10);
  assert.ok(rescheduled.every((call) => call.maxAttempts === 8));
});

test('a failed device-token store counts toward the failure threshold, as any other fault', async () => {
  const native = createNativePushService({
    config: { enabled: true, projectId: 'p', serviceToken: 's' },
    tokens: () => ({
      async listByUserId() {
        throw new Error('database unavailable');
      },
      async removeToken() {}
    }),
    client: {
      async send() {
        return assert.fail('no token was loaded, so nothing is sent');
      }
    },
    logger: { warn() {}, error() {} }
  });
  const { rescheduled, disabledReason } = await runBatch(fanoutProvider(NOTHING_SENT, native.sendToUser), 10);
  assert.equal(disabledReason, 'provider_failure_threshold');
  assert.equal(rescheduled.length, 10);
  assert.ok(rescheduled.every((call) => call.maxAttempts === 8));
});

test(
  'the worker provider delivers an outbox mention to a stored RuStore token',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('ada', 'ada', 'x')`);
    await pool.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 'ada', now() + interval '1 day')`);
    await createDeviceTokenRepository({ pool }).upsert({
      userId: 'ada',
      sessionId: 's1',
      provider: 'rustore',
      token: 'ada-phone',
      appVersion: '1.0.0'
    });
    const requests: Array<{ url: string; body: unknown }> = [];
    const provider = createNotificationDeliveryProvider({
      pool,
      // Web Push stays off: no VAPID keys.
      env: {},
      config: readNotificationDeliveryWorkerConfig({
        RUSTORE_PUSH_PROJECT_ID: 'project-1',
        RUSTORE_PUSH_SERVICE_TOKEN: 'secret'
      }),
      fetch: async (input, init) => {
        // The client posts a string URL and a JSON string body.
        requests.push({
          url: typeof input === 'string' ? input : '',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
        });
        return new Response('{}', { status: 200 });
      }
    });

    const result = await provider.deliver({
      recipientUserId: 'ada',
      payload: {
        contractVersion: 1,
        notificationId: 'n1',
        revision: 2,
        dedupeKey: 'n1:2',
        title: 'Упоминание',
        body: 'текст',
        url: '/?room=r1&message=m1'
      }
    });

    assert.deepEqual(result, { delivered: true, suppressed: false, sent: 1, removed: 0 });
    assert.equal(requests[0]?.url, 'https://vkpns.rustore.ru/v1/projects/project-1/messages:send');
    assert.deepEqual(requests[0]?.body, {
      message: {
        token: 'ada-phone',
        data: { v: '1', type: 'notification', url: '/?room=r1&message=m1', dedupeKey: 'n1:2', notificationId: 'n1' },
        notification: { title: 'Упоминание', body: 'текст' },
        android: { ttl: '3600s', notification: { channel_id: 'messages' } }
      }
    });
  }
);
