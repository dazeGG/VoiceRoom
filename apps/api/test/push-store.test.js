'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushStore } = require('../src/lib/push-store');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('push subscription CRUD upserts endpoints and isolates deletion by user', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const pushes = createPushStore({ databaseUrl, logger: SILENT });
  t.after(async () => { await pushes.close(); await users.close(); await cleanup(); });

  const alice = (await users.createUser({ login: 'push-alice', displayName: 'Alice', password: 'password123' })).user;
  const bob = (await users.createUser({ login: 'push-bob', displayName: 'Bob', password: 'password123' })).user;
  const subscription = { endpoint: 'https://push.example/device', keys: { p256dh: 'key-one', auth: 'auth-one' } };

  await pushes.upsert({ userId: alice.id, subscription, metadata: { browser: 'test' } });
  assert.equal((await pushes.listByUserId(alice.id)).length, 1);
  assert.equal(await pushes.remove({ userId: bob.id, endpoint: subscription.endpoint }), false);

  const rejectedClaim = await pushes.upsert({
    userId: bob.id,
    subscription: { ...subscription, keys: { p256dh: 'stolen-key', auth: 'stolen-auth' } }
  });
  assert.equal(rejectedClaim, null);
  assert.equal((await pushes.listByUserId(alice.id)).length, 1);

  await pushes.upsert({
    userId: alice.id,
    subscription: { ...subscription, keys: { p256dh: 'key-two', auth: 'auth-two' } }
  });
  const current = await pushes.listByUserId(alice.id);
  assert.equal(current.length, 1);
  assert.equal(current[0].keys.p256dh, 'key-two');
  const switched = await pushes.upsert({ userId: bob.id, subscription: { ...subscription, keys: current[0].keys } });
  assert.equal(switched.userId, bob.id);
  assert.deepEqual(await pushes.listByUserId(alice.id), []);
  assert.equal(await pushes.remove({ userId: bob.id, endpoint: subscription.endpoint }), true);
  assert.deepEqual(await pushes.listByUserId(bob.id), []);

  await pushes.upsert({
    userId: alice.id,
    subscription: { endpoint: 'https://push.example/alice-password', keys: { p256dh: 'alice-key', auth: 'alice-auth' } }
  });
  assert.equal((await pushes.listByUserId(alice.id)).length, 1);
  assert.equal((await users.changePassword({
    userId: alice.id,
    currentPassword: 'password123',
    newPassword: 'password456'
  })).status, 'updated');
  assert.deepEqual(await pushes.listByUserId(alice.id), []);
});

test('push subscriptions transactionally prune the oldest entries above the per-user cap', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const pushes = createPushStore({ databaseUrl, logger: SILENT, maxSubscriptionsPerUser: 2 });
  t.after(async () => { await pushes.close(); await users.close(); await cleanup(); });

  const user = (await users.createUser({ login: 'push-limit', displayName: 'Push Limit', password: 'password123' })).user;
  for (const token of ['one', 'two', 'three']) {
    await pushes.upsert({
      userId: user.id,
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/${token}`,
        keys: { p256dh: `key-${token}`, auth: `auth-${token}` }
      }
    });
  }

  assert.deepEqual(
    (await pushes.listByUserId(user.id)).map((item) => item.endpoint),
    ['https://fcm.googleapis.com/fcm/send/two', 'https://fcm.googleapis.com/fcm/send/three']
  );

  await Promise.all(['four', 'five', 'six', 'seven'].map((token) => pushes.upsert({
    userId: user.id,
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${token}`,
      keys: { p256dh: `key-${token}`, auth: `auth-${token}` }
    }
  })));
  assert.equal((await pushes.listByUserId(user.id)).length, 2);
});
