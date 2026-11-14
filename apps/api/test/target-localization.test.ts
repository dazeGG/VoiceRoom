import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './db-harness.ts';
import { createDeviceTokenRepository } from '../src/domains/notifications/device-token.repository.ts';
import { createPushSubscriptionRepository } from '../src/domains/notifications/push-subscription.repository.ts';
import { createPushService } from '../src/lib/push-service.ts';
import { parsePushPayload } from '@voice-room/shared/notifications';
import type { PushLocaleIntent } from '@voice-room/shared/contracts/push-registration';
import { createNotificationDispatch } from '../src/domains/notifications/notification-dispatch.ts';
import { localizeNotificationPayload } from '@voice-room/shared/notification-text';
import type { AccountMessage } from '../src/realtime/account-events.ts';
import { storedUser } from './fakes/index.ts';

const skip = !process.env.TEST_DATABASE_URL;
const intent = (locale: PushLocaleIntent['locale'], expectedVersion: string | null): PushLocaleIntent => ({
  protocol: 1,
  locale,
  expectedVersion
});

test('invitation notifications carry semantic metadata for foreground and per-target push rendering', async () => {
  const events: AccountMessage[] = [];
  const sent: unknown[] = [];
  const dispatch = createNotificationDispatch({
    preferences: async () => ({ mutedPeerIds: [] }),
    notifyUser: (_userId, event) => {
      events.push(event);
      return 1;
    },
    logger: () => ({ warn() {}, error() {} }),
    push: () => ({
      config: { enabled: true },
      async sendToUser(_userId, payload) {
        sent.push(payload);
      }
    })
  });
  const invite = { roomId: 'room', roomName: 'Élodie 🐈', status: 'pending' as const, expiresAt: null };
  await dispatch.broadcastDmNotification('recipient', storedUser({ id: 'sender', login: 'ada' }), {
    id: 'invitation',
    body: 'Приглашение в комнату',
    createdAt: 1,
    invite
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const [event] = events;
  assert.equal(event?.type, 'notification.dm.message');
  if (event?.type === 'notification.dm.message') assert.deepEqual(event.message.invite, invite);
  const localized = parsePushPayload(localizeNotificationPayload(sent[0], 'fr'));
  assert.equal(localized.body, 'Invitation au salon « Élodie 🐈 »');
});

test('native association CAS fences same-language transfers and makes conflicts write-free', { skip }, async (t) => {
  const { cleanup, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await pool.query("INSERT INTO users (id,login,password_hash) VALUES ('a','aaa','x'),('b','bbb','x')");
  await pool.query(
    "INSERT INTO sessions (id,user_id,expires_at) VALUES ('sa','a',now()+interval '1 day'),('sb','b',now()+interval '1 day')"
  );
  const tokens = createDeviceTokenRepository({ pool, maxTokensPerUser: 1 });
  const base = { provider: 'rustore' as const, token: 'one', appVersion: '1.0.0', userId: 'a', sessionId: 'sa' };
  const first = await tokens.register({ ...base, localeState: intent('fr', null) });
  assert.equal(first.status, 'registered');
  if (first.status !== 'registered') return;
  const moved = await tokens.register({
    ...base,
    userId: 'b',
    sessionId: 'sb',
    localeState: intent('fr', first.registration.version)
  });
  assert.equal(moved.status, 'registered');
  if (moved.status !== 'registered') return;
  assert.notEqual(moved.registration.version, first.registration.version);
  const before = await pool.query<Record<string, unknown>>('SELECT * FROM device_tokens ORDER BY id');
  const stale = await tokens.register({
    ...base,
    notificationChannels: ['calls'],
    localeState: intent('en', first.registration.version)
  });
  assert.deepEqual(stale, { status: 'locale_conflict', registration: moved.registration });
  assert.deepEqual(
    (await pool.query<Record<string, unknown>>('SELECT * FROM device_tokens ORDER BY id')).rows,
    before.rows
  );
  await tokens.upsert({ ...base, userId: 'b', sessionId: 'sb' });
  assert.equal((await tokens.listByUserId('b'))[0]?.locale, 'fr', 'legacy refresh preserves selected locale');
  await tokens.removeToken({ provider: 'rustore', token: 'one' });
  assert.deepEqual(await tokens.register({ ...base, localeState: intent('en', moved.registration.version) }), {
    status: 'locale_conflict',
    registration: null
  });
  const recreated = await tokens.register({ ...base, localeState: intent('en', null) });
  assert.equal(recreated.status, 'registered');
  if (recreated.status === 'registered') assert.notEqual(recreated.registration.version, moved.registration.version);
});

test(
  'web target CAS checks proof before state, fences transfer and preserves metadata on conflicts',
  { skip },
  async (t) => {
    const { cleanup, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await pool.query("INSERT INTO users (id,login,password_hash) VALUES ('a','aaa','x'),('b','bbb','x')");
    const pushes = createPushSubscriptionRepository({ pool });
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/localization',
      keys: { p256dh: 'p', auth: 'a' }
    };
    const first = await pushes.register({
      userId: 'a',
      subscription,
      metadata: { browser: 'test' },
      localeState: intent('fr', null)
    });
    assert.equal(first.status, 'subscribed');
    if (first.status !== 'subscribed') return;
    const repeat = await pushes.register({
      userId: 'a',
      subscription,
      metadata: { browser: 'test' },
      localeState: intent('fr', first.registration.version)
    });
    assert.equal(repeat.status, 'subscribed');
    if (repeat.status === 'subscribed') assert.equal(repeat.registration.version, first.registration.version);
    assert.deepEqual(
      await pushes.register({
        userId: 'b',
        subscription: { ...subscription, keys: { p256dh: 'bad', auth: 'bad' } },
        localeState: intent('en', first.registration.version)
      }),
      { status: 'conflict' }
    );
    const moved = await pushes.register({
      userId: 'b',
      subscription,
      localeState: intent('fr', first.registration.version)
    });
    assert.equal(moved.status, 'subscribed');
    if (moved.status !== 'subscribed') return;
    const before = await pool.query<Record<string, unknown>>('SELECT * FROM push_subscriptions ORDER BY id');
    assert.deepEqual(
      await pushes.register({
        userId: 'a',
        subscription,
        metadata: { stale: true },
        localeState: intent('en', first.registration.version)
      }),
      { status: 'locale_conflict', registration: moved.registration }
    );
    assert.deepEqual(
      (await pool.query<Record<string, unknown>>('SELECT * FROM push_subscriptions ORDER BY id')).rows,
      before.rows
    );
    await pushes.upsert({ userId: 'b', subscription });
    assert.equal((await pushes.listByUserId('b'))[0]?.metadata.locale, 'fr');
  }
);

test('web target rendering chooses each client language, preserves content and strips internal descriptors', async () => {
  const deliveries: Array<{ endpoint: string; title: string | undefined; body: string | undefined; raw: unknown }> = [];
  const service = createPushService({
    config: { enabled: true, vapidPublicKey: 'p', privateKey: 's', subject: 'mailto:admin@example.com' },
    store: {
      async listByUserId() {
        return ['fr', 'en', 'ru'].map((locale) => ({
          endpoint: `https://fcm.googleapis.com/fcm/send/${locale}`,
          keys: { p256dh: 'p', auth: 'a' },
          metadata: { locale }
        }));
      },
      async markSuccess() {},
      async removeByEndpoint() {}
    },
    client: {
      setVapidDetails() {},
      async sendNotification(subscription, raw) {
        const value: unknown = JSON.parse(raw);
        const payload = parsePushPayload(value);
        deliveries.push({ endpoint: subscription.endpoint, title: payload.title, body: payload.body, raw: value });
      }
    }
  });
  await service.sendToUser('a', { title: 'legacy', body: 'User text 🐈', copy: { title: { key: 'newMessage' } } });
  assert.deepEqual(
    deliveries.map(({ title, body }) => ({ title, body })),
    [
      { title: 'Nouveau message', body: 'User text 🐈' },
      { title: 'New message', body: 'User text 🐈' },
      { title: 'Новое сообщение', body: 'User text 🐈' }
    ]
  );
  assert.equal(JSON.stringify(deliveries).includes('copy'), false);
});
