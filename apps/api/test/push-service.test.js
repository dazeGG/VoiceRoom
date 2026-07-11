'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushService, readPushConfig, shouldDeliverPush } = require('../src/lib/push-service');

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
        { endpoint: 'https://push.example/one', keys: { p256dh: 'a', auth: 'b' } },
        { endpoint: 'https://push.example/two', keys: { p256dh: 'c', auth: 'd' } }
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
  assert.deepEqual(marked.sort(), ['https://push.example/one', 'https://push.example/two']);
  assert.equal(deliveries[0].payload.type, 'ring');
  assert.deepEqual(deliveries[0].options, { TTL: 30 });
});

test('push service removes expired endpoints on 404/410 and tolerates other failures', async () => {
  const removed = [];
  const store = {
    async listByUserId() {
      return [410, 404, 500].map((status) => ({ endpoint: `https://push.example/${status}`, keys: { p256dh: 'a', auth: 'b' } }));
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
  assert.deepEqual(removed.sort(), ['https://push.example/404', 'https://push.example/410']);
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
