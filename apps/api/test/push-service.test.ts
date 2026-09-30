import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPushService,
  readPushConfig,
  resolvePushTtl,
  shouldDeliverPush,
  type PushSubscriptionStore,
  type WebPushClient
} from '../src/lib/push-service.ts';
import { fake } from './fakes/index.ts';

// What a logger received, one entry per call.
type LogCall = unknown[];

function pushError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const ENABLED_ENV = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:admin@example.com'
};

test('push config is disabled unless every VAPID value is present', () => {
  assert.deepEqual(readPushConfig({}), {
    enabled: false,
    vapidPublicKey: '',
    privateKey: '',
    subject: ''
  });
  assert.equal(readPushConfig(ENABLED_ENV).enabled, true);
});

test('push policy centralizes DND, user, and room mute filtering', () => {
  assert.equal(shouldDeliverPush({ doNotDisturb: true, mutedPeerIds: [], mutedRoomIds: [] }, {}), false);
  assert.equal(
    shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: ['peer-1'], mutedRoomIds: [] }, { peerUserId: 'peer-1' }),
    false
  );
  assert.equal(
    shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: [], mutedRoomIds: ['room-1'] }, { roomId: 'room-1' }),
    false
  );
  assert.equal(
    shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: [], mutedRoomIds: [] }, { peerUserId: 'peer-1' }),
    true
  );
  assert.equal(
    shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: [], mutedRoomIds: [] }, { roomId: 'room-1' }),
    true
  );
});

test('push service delivers to all subscriptions and records successes', async () => {
  const marked: string[] = [];
  const deliveries: { subscription: unknown; payload: { type: string }; options: unknown }[] = [];
  const store: PushSubscriptionStore = {
    async listByUserId() {
      return [
        { endpoint: 'https://fcm.googleapis.com/fcm/send/one', keys: { p256dh: 'a', auth: 'b' } },
        { endpoint: 'https://fcm.googleapis.com/fcm/send/two', keys: { p256dh: 'c', auth: 'd' } }
      ];
    },
    async markSuccess(endpoint) {
      marked.push(endpoint);
    },
    async removeByEndpoint() {}
  };
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification(subscription, payload, options) {
      deliveries.push({ subscription, payload: JSON.parse(payload) as { type: string }, options });
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client });
  const result = await service.sendToUser('user-1', { type: 'ring' }, { ttl: 30 });

  assert.deepEqual(result, { enabled: true, sent: 2, removed: 0 });
  assert.deepEqual(marked.sort(), [
    'https://fcm.googleapis.com/fcm/send/one',
    'https://fcm.googleapis.com/fcm/send/two'
  ]);
  assert.equal(deliveries[0]?.payload.type, 'ring');
  assert.deepEqual(deliveries[0]?.options, { TTL: 30 });
});

test('push service derives ring TTL from expiry and skips expired invitations', async () => {
  const deliveries: unknown[] = [];
  let listCalls = 0;
  const store: PushSubscriptionStore = {
    async listByUserId() {
      listCalls += 1;
      return [{ endpoint: 'https://fcm.googleapis.com/fcm/send/ring', keys: { p256dh: 'a', auth: 'b' } }];
    },
    async markSuccess() {},
    async removeByEndpoint() {}
  };
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification(_subscription, _payload, options) {
      deliveries.push(options);
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, now: () => 100_000 });

  assert.deepEqual(await service.sendToUser('user-1', { type: 'ring' }, { expiresAt: 130_000 }), {
    enabled: true,
    sent: 1,
    removed: 0
  });
  assert.deepEqual(deliveries, [{ TTL: 30 }]);
  assert.equal(resolvePushTtl({ expiresAt: 129_001, ttl: 60 }, 100_000), 30);

  assert.deepEqual(await service.sendToUser('user-1', { type: 'ring' }, { expiresAt: 99_999 }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
  assert.equal(listCalls, 1);
  assert.equal(deliveries.length, 1);
});

test('push service removes expired endpoints on 404/410 and tolerates other failures', async () => {
  const removed: string[] = [];
  const store: PushSubscriptionStore = {
    async listByUserId() {
      return [410, 404, 500].map((status) => ({
        endpoint: `https://fcm.googleapis.com/fcm/send/${status}`,
        keys: { p256dh: 'a', auth: 'b' }
      }));
    },
    async markSuccess() {},
    async removeByEndpoint(endpoint) {
      removed.push(endpoint);
    }
  };
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification(subscription) {
      throw pushError('failed', Number(subscription.endpoint.split('/').at(-1)));
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger: { warn() {} } });
  const result = await service.sendToUser('user-1', { type: 'dm.message' });

  assert.deepEqual(result, { enabled: true, sent: 0, removed: 2 });
  assert.deepEqual(removed.sort(), [
    'https://fcm.googleapis.com/fcm/send/404',
    'https://fcm.googleapis.com/fcm/send/410'
  ]);
});

test('push service drops invalid stored endpoints without sending or leaking capability URLs', async () => {
  const endpoint = 'https://internal.example/secret-capability-token';
  const removed: string[] = [];
  const logs: LogCall[] = [];
  const store = fake<PushSubscriptionStore>({
    async listByUserId() {
      return [{ endpoint, keys: { p256dh: 'a', auth: 'b' } }];
    },
    async removeByEndpoint(value) {
      removed.push(value);
    }
  });
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification() {
      assert.fail('invalid endpoint must not be contacted');
    }
  };
  const logger = {
    warn(...items: unknown[]) {
      logs.push(items);
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger });

  assert.deepEqual(await service.sendToUser('user-1', { type: 'ring' }), { enabled: true, sent: 0, removed: 1 });
  assert.deepEqual(removed, [endpoint]);
  assert.doesNotMatch(JSON.stringify(logs), /secret-capability-token/);
});

test('push delivery failures log only a safe host and endpoint hash', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-capability-token';
  const logs: LogCall[] = [];
  const store: PushSubscriptionStore = {
    async listByUserId() {
      return [{ endpoint, keys: { p256dh: 'a', auth: 'b' } }];
    },
    async markSuccess() {},
    async removeByEndpoint() {}
  };
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification() {
      throw pushError(`failed to deliver ${endpoint}`, 500);
    }
  };
  const logger = {
    warn(...items: unknown[]) {
      logs.push(items);
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger });

  await service.sendToUser('user-1', { type: 'ring' });
  const fields = logs[0]?.[0] as { pushHost: string; pushEndpointHash: string };
  assert.equal(fields.pushHost, 'fcm.googleapis.com');
  assert.match(fields.pushEndpointHash, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(logs), /secret-capability-token/);
});

test('push service degrades cleanly when subscription storage is unavailable', async () => {
  const store = fake<PushSubscriptionStore>({
    async listByUserId() {
      throw new Error('database unavailable');
    }
  });
  const client: WebPushClient = {
    setVapidDetails() {},
    async sendNotification() {
      assert.fail('must not send');
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger: { warn() {} } });
  assert.deepEqual(await service.sendToUser('user-1', { type: 'dm.message' }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
});
