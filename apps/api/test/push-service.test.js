'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushService, readPushConfig, resolvePushTtl, shouldDeliverPush } = require('../src/lib/push-service');

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

test('push policy centralizes DND and DM mute filtering', () => {
  assert.equal(shouldDeliverPush({ doNotDisturb: true, mutedPeerIds: [] }, {}), false);
  assert.equal(shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: ['peer-1'] }, { peerUserId: 'peer-1' }), false);
  assert.equal(shouldDeliverPush({ doNotDisturb: false, mutedPeerIds: [] }, { peerUserId: 'peer-1' }), true);
});

test('push service delivers to all subscriptions and records successes', async () => {
  const marked = [];
  const deliveries = [];
  const store = {
    async listByUserId() {
      return [
        { endpoint: 'https://fcm.googleapis.com/fcm/send/one', keys: { p256dh: 'a', auth: 'b' } },
        { endpoint: 'https://fcm.googleapis.com/fcm/send/two', keys: { p256dh: 'c', auth: 'd' } }
      ];
    },
    async markSuccess(endpoint) { marked.push(endpoint); },
    async removeByEndpoint() {}
  };
  const client = {
    setVapidDetails() {},
    async sendNotification(subscription, payload, options) {
      deliveries.push({ subscription, payload: JSON.parse(payload), options });
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client });
  const result = await service.sendToUser('user-1', { type: 'ring' }, { ttl: 30 });

  assert.deepEqual(result, { enabled: true, sent: 2, removed: 0 });
  assert.deepEqual(marked.sort(), ['https://fcm.googleapis.com/fcm/send/one', 'https://fcm.googleapis.com/fcm/send/two']);
  assert.equal(deliveries[0].payload.type, 'ring');
  assert.deepEqual(deliveries[0].options, { TTL: 30 });
});

test('push service derives ring TTL from expiry and skips expired invitations', async () => {
  const deliveries = [];
  let listCalls = 0;
  const store = {
    async listByUserId() {
      listCalls += 1;
      return [{ endpoint: 'https://push.example/ring', keys: { p256dh: 'a', auth: 'b' } }];
    },
    async markSuccess() {},
    async removeByEndpoint() {}
  };
  const client = {
    setVapidDetails() {},
    async sendNotification(_subscription, _payload, options) {
      deliveries.push(options);
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, now: () => 100_000 });

  assert.deepEqual(
    await service.sendToUser('user-1', { type: 'ring' }, { expiresAt: 130_000 }),
    { enabled: true, sent: 1, removed: 0 }
  );
  assert.deepEqual(deliveries, [{ TTL: 30 }]);
  assert.equal(resolvePushTtl({ expiresAt: 129_001, ttl: 60 }, 100_000), 30);

  assert.deepEqual(
    await service.sendToUser('user-1', { type: 'ring' }, { expiresAt: 99_999 }),
    { enabled: true, sent: 0, removed: 0 }
  );
  assert.equal(listCalls, 1);
  assert.equal(deliveries.length, 1);
});

test('push service removes expired endpoints on 404/410 and tolerates other failures', async () => {
  const removed = [];
  const store = {
    async listByUserId() {
      return [410, 404, 500].map((status) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${status}`, keys: { p256dh: 'a', auth: 'b' } }));
    },
    async markSuccess() {},
    async removeByEndpoint(endpoint) { removed.push(endpoint); }
  };
  const client = {
    setVapidDetails() {},
    async sendNotification(subscription) {
      const error = new Error('failed');
      error.statusCode = Number(subscription.endpoint.split('/').at(-1));
      throw error;
    }
  };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger: { warn() {} } });
  const result = await service.sendToUser('user-1', { type: 'dm.message' });

  assert.deepEqual(result, { enabled: true, sent: 0, removed: 2 });
  assert.deepEqual(removed.sort(), ['https://fcm.googleapis.com/fcm/send/404', 'https://fcm.googleapis.com/fcm/send/410']);
});

test('push service drops invalid stored endpoints without sending or leaking capability URLs', async () => {
  const endpoint = 'https://internal.example/secret-capability-token';
  const removed = [];
  const logs = [];
  const store = {
    async listByUserId() { return [{ endpoint, keys: { p256dh: 'a', auth: 'b' } }]; },
    async removeByEndpoint(value) { removed.push(value); }
  };
  const client = {
    setVapidDetails() {},
    async sendNotification() { assert.fail('invalid endpoint must not be contacted'); }
  };
  const logger = { warn(...items) { logs.push(items); } };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger });

  assert.deepEqual(await service.sendToUser('user-1', { type: 'ring' }), { enabled: true, sent: 0, removed: 1 });
  assert.deepEqual(removed, [endpoint]);
  assert.doesNotMatch(JSON.stringify(logs), /secret-capability-token/);
});

test('push delivery failures log only a safe host and endpoint hash', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-capability-token';
  const logs = [];
  const store = {
    async listByUserId() { return [{ endpoint, keys: { p256dh: 'a', auth: 'b' } }]; },
    async markSuccess() {},
    async removeByEndpoint() {}
  };
  const client = {
    setVapidDetails() {},
    async sendNotification() {
      const error = new Error(`failed to deliver ${endpoint}`);
      error.statusCode = 500;
      throw error;
    }
  };
  const logger = { warn(...items) { logs.push(items); } };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger });

  await service.sendToUser('user-1', { type: 'ring' });
  assert.equal(logs[0][0].pushHost, 'fcm.googleapis.com');
  assert.match(logs[0][0].pushEndpointHash, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(logs), /secret-capability-token/);
});

test('push service degrades cleanly when subscription storage is unavailable', async () => {
  const store = { async listByUserId() { throw new Error('database unavailable'); } };
  const client = { setVapidDetails() {}, async sendNotification() { assert.fail('must not send'); } };
  const service = createPushService({ store, env: ENABLED_ENV, client, logger: { warn() {} } });
  assert.deepEqual(await service.sendToUser('user-1', { type: 'dm.message' }), {
    enabled: true,
    sent: 0,
    removed: 0
  });
});
