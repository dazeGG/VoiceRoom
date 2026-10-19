// Branch-by-branch proofs for notification settings, presence status and
// push subscriptions (domains/notifications/notification-settings.*).

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import {
  cleanPushSubscription,
  createNotificationSettingsService,
  type MutationResult,
  type NotificationPreferenceStore,
  type NotificationSettingsService
} from '../src/domains/notifications/notification-settings.service.ts';
import { fake, notificationPreferences, storedUser } from './fakes/index.ts';
import { registerNotificationSettingsRoutes } from '../src/domains/notifications/notification-settings.routes.ts';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';
import type { ApiContext } from '../src/app/context.ts';
import { Failure } from '@voice-room/shared/contracts/http';
import { checked } from './helpers/checked.ts';

const ME = storedUser({ id: 'user-1', login: 'alice' });
const PEER = '22222222-2222-4222-8222-222222222222';
const SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

test('push subscriptions are cleaned and bounded', () => {
  assert.deepEqual(cleanPushSubscription(SUBSCRIPTION), SUBSCRIPTION);
  assert.equal(cleanPushSubscription(null), null);
  assert.equal(cleanPushSubscription({ ...SUBSCRIPTION, endpoint: 'ftp://x' }), null);
  assert.equal(cleanPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: '', auth: 'a' } }), null);
  assert.equal(cleanPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: 'p', auth: 'x'.repeat(1025) } }), null);
  assert.equal(cleanPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: 'x'.repeat(1025), auth: 'a' } }), null);
});

type HarnessOptions = {
  enabled?: boolean;
  rate?: { allowed: boolean; retryAfterSeconds?: number };
  upserted?: boolean | null;
  result?: MutationResult | null;
};

const AWAY = notificationPreferences({ presenceStatus: 'away' });

function harness({ enabled = true, rate = { allowed: true }, upserted = true, result = null }: HarnessOptions = {}) {
  const calls: {
    presence: unknown[];
    events: Array<{ type?: string }>;
    friends: unknown[];
    removed: unknown[];
    upserts: Array<{ metadata: { userAgent: string } }>;
  } = { presence: [], events: [], friends: [], removed: [], upserts: [] };
  const updated = result || { status: 'updated', preferences: AWAY };
  const store: NotificationPreferenceStore = {
    async getPreferences() {
      return notificationPreferences();
    },
    async setDmMute(input) {
      return { status: 'muted', preferences: notificationPreferences({ mutedPeerIds: [input.peerUserId] }) };
    },
    async setRoomMute(input) {
      return {
        status: 'unmuted',
        preferences: notificationPreferences({ mutedRoomIds: input.muted ? [input.roomId] : [] })
      };
    },
    async setPrivateNotifications(input) {
      return { status: 'updated', preferences: notificationPreferences(input) };
    },
    async setDoNotDisturb() {
      return updated;
    },
    async setPresenceStatus() {
      return updated;
    }
  };
  const service = createNotificationSettingsService({
    preferences: () => store,
    pushes: () => ({
      async upsert(input) {
        calls.upserts.push(input);
        return upserted;
      },
      async remove(input) {
        calls.removed.push(input);
      }
    }),
    pushConfig: () => ({ enabled, vapidPublicKey: 'vapid' }),
    pushLimiter: { check: () => rate },
    setPresence: (userId, status) => calls.presence.push(status),
    notifyUser: (userId, event) => calls.events.push(event),
    broadcastProfileToFriends: async (user) => {
      calls.friends.push(user.presenceStatus);
    }
  });
  return { calls, service };
}

test('presence changes normalise the status and reach devices and friends', async () => {
  const { calls, service } = harness();
  const result = await service.setPresenceStatus(ME, 'away', true);
  assert.deepEqual(result.preferences, AWAY);
  assert.deepEqual([calls.presence, calls.friends], [['away'], ['away']]);
  assert.equal(calls.events[0]?.type, 'notification-settings-updated');

  // A stored do-not-disturb flag without its status still reads as 'dnd'. The
  // store's type promises a status; a row without one is what this guards.
  const dnd = harness({
    result: {
      status: 'updated',
      preferences: Object.assign(notificationPreferences({ doNotDisturb: true }), { presenceStatus: '' })
    }
  });
  assert.deepEqual(
    (await dnd.service.setDoNotDisturb(ME, true)).preferences,
    notificationPreferences({ doNotDisturb: true, presenceStatus: 'dnd' })
  );
  const online = harness({ result: { status: 'updated', preferences: notificationPreferences() } });
  assert.equal((await online.service.setDoNotDisturb(ME, false)).preferences.presenceStatus, 'online');
  const missing = harness({ result: { status: 'not_found', preferences: notificationPreferences() } });
  assert.equal((await missing.service.setPresenceStatus(ME, 'online', false)).status, 'not_found');
  assert.deepEqual(missing.calls.events, []);
});

test('mutes and privacy pass straight to the preference store', async () => {
  const { service } = harness();
  assert.deepEqual((await service.setDmMute('user-1', PEER, true)).preferences.mutedPeerIds, [PEER]);
  assert.deepEqual((await service.setRoomMute('user-1', 'room-1', true)).preferences.mutedRoomIds, ['room-1']);
  assert.equal((await service.setPrivateNotifications('user-1', true)).preferences.privateNotifications, true);
  assert.deepEqual(await service.preferences('user-1'), notificationPreferences());
  assert.equal(service.pushConfig().vapidPublicKey, 'vapid');
});

test('push subscribe and unsubscribe', async () => {
  assert.equal((await harness({ enabled: false }).service.subscribe('u', SUBSCRIPTION, 'UA')).status, 'disabled');
  assert.equal((await harness().service.subscribe('u', {}, 'UA')).status, 'invalid');
  assert.deepEqual(
    await harness({ rate: { allowed: false, retryAfterSeconds: 7 } }).service.subscribe('u', SUBSCRIPTION, 'UA'),
    { status: 'rate_limited', retryAfterSeconds: 7 }
  );
  assert.deepEqual(await harness({ rate: { allowed: false } }).service.unsubscribe('u', SUBSCRIPTION.endpoint), {
    status: 'rate_limited',
    retryAfterSeconds: 0
  });
  assert.equal((await harness({ upserted: null }).service.subscribe('u', SUBSCRIPTION, 'UA')).status, 'conflict');
  const { calls, service } = harness();
  assert.equal((await service.subscribe('u', SUBSCRIPTION, 'x'.repeat(600))).status, 'subscribed');
  assert.equal(calls.upserts[0]?.metadata.userAgent.length, 512);
  assert.equal((await service.unsubscribe('u', 'nope')).status, 'invalid');
  assert.equal((await service.unsubscribe('u', SUBSCRIPTION.endpoint)).status, 'removed');
  assert.deepEqual(calls.removed, [{ userId: 'u', endpoint: SUBSCRIPTION.endpoint }]);
});

// --- routes -------------------------------------------------------------------------

const PRIVATE = notificationPreferences({ privateNotifications: true });

/** What each service method the routes call resolves to. */
type Outcomes = {
  [Method in Exclude<keyof NotificationSettingsService, 'pushConfig'>]: Awaited<
    ReturnType<NotificationSettingsService[Method]>
  >;
};

function routeApp(
  t: TestContext,
  outcomes: Partial<Outcomes> = {},
  { signedIn = true, user = ME }: { signedIn?: boolean; user?: { id: string; login?: string } } = {}
) {
  const app = fastify({ ajv: AJV_OPTIONS });
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen: Record<string, unknown[]> = {};
  const updated: MutationResult = { status: 'updated', preferences: PRIVATE };
  const record =
    <Name extends keyof Outcomes>(name: Name, value: Outcomes[Name]) =>
    async (...args: unknown[]): Promise<Outcomes[Name]> => {
      seen[name] = args;
      return outcomes[name] ?? value;
    };
  registerNotificationSettingsRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => 'ip',
      resolveSession: async () => (signedIn ? { user: storedUser(user) } : null),
      hashIp: (ip: string) => ip
    },
    fake<NotificationSettingsService>({
      preferences: record('preferences', notificationPreferences()),
      setDmMute: record('setDmMute', updated),
      setRoomMute: record('setRoomMute', updated),
      setPrivateNotifications: record('setPrivateNotifications', updated),
      setDoNotDisturb: record('setDoNotDisturb', updated),
      setPresenceStatus: record('setPresenceStatus', updated),
      pushConfig: () => ({ enabled: true, vapidPublicKey: 'vapid' }),
      subscribe: record('subscribe', { status: 'subscribed' }),
      unsubscribe: record('unsubscribe', { status: 'removed' })
    })
  );
  t.after(() => app.close());
  return { app, seen };
}

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';

async function call(app: FastifyInstance, method: Method, url: string, payload?: object) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  const body: unknown = response.json();
  return { status: response.statusCode, body, retryAfter: response.headers['retry-after'] };
}

const ROUTES: Array<[Method, string, object?]> = [
  ['GET', '/api/notifications/preferences'],
  ['PUT', `/api/notifications/dm/${PEER}/mute`, { muted: true }],
  ['PUT', '/api/notifications/room/room-1/mute', { muted: false }],
  ['PUT', '/api/notifications/privacy', { privateNotifications: true }],
  ['POST', '/api/notifications/settings', { dnd: true }],
  ['POST', '/api/presence/status', { status: 'away', automatic: true }],
  ['POST', '/api/push/subscriptions', { subscription: SUBSCRIPTION }],
  ['DELETE', '/api/push/subscriptions', { endpoint: SUBSCRIPTION.endpoint }]
];

test('every settings route needs a session and answers it', async (t) => {
  const anonymous = routeApp(t, {}, { signedIn: false }).app;
  const { app, seen } = routeApp(t);
  for (const [method, url, payload] of ROUTES) {
    assert.equal((await call(anonymous, method, url, payload)).status, 401, url);
    const answered = await call(app, method, url, payload);
    assert.ok([200, 201].includes(answered.status), url);
  }
  assert.deepEqual((await call(app, 'PUT', `/api/notifications/dm/${PEER}/mute`, { muted: true })).body, {
    ok: true,
    muted: true,
    preferences: PRIVATE
  });
  assert.deepEqual((await call(app, 'PUT', '/api/notifications/privacy', { privateNotifications: false })).body, {
    ok: true,
    preferences: PRIVATE
  });
  assert.deepEqual(seen.setPresenceStatus?.slice(1, 3), ['away', true]);
  assert.deepEqual((await call(app, 'GET', '/api/push/config')).body, { enabled: true, vapidPublicKey: 'vapid' });
});

test('settings refusals keep their texts', async (t) => {
  const { app } = routeApp(t);
  const cases: Array<[Method, string, object, number, string]> = [
    ['PUT', '/api/notifications/dm/bad/mute', { muted: true }, 404, 'Invalid notification target'],
    ['PUT', '/api/notifications/dm/user-1/mute', { muted: true }, 404, 'Invalid notification target'],
    ['PUT', `/api/notifications/dm/${PEER}/mute`, { muted: 'yes' }, 400, 'muted must be a boolean'],
    ['PUT', '/api/notifications/room/%20/mute', { muted: true }, 404, 'Invalid notification target'],
    ['PUT', '/api/notifications/room/room-1/mute', {}, 400, 'muted must be a boolean'],
    ['PUT', '/api/notifications/privacy', {}, 400, 'privateNotifications must be a boolean'],
    ['POST', '/api/notifications/settings', { dnd: 1 }, 400, 'dnd must be a boolean'],
    ['POST', '/api/presence/status', { status: 'busy' }, 400, 'status must be one of: online, away, dnd, offline'],
    ['POST', '/api/presence/status', { status: 'away', automatic: 'yes' }, 400, 'automatic must be a boolean'],
    [
      'POST',
      '/api/presence/status',
      { status: 'dnd', automatic: true },
      400,
      'automatic presence can only transition between online and away'
    ]
  ];
  for (const [method, url, payload, status, error] of cases) {
    const response = await call(app, method, url, payload);
    const what = `${method} ${url} ${JSON.stringify(payload)}`;
    assert.deepEqual([response.status, checked(Failure, response.body, what).error], [status, error], what);
  }
  const self = await call(routeApp(t, {}, { user: { id: PEER } }).app, 'PUT', `/api/notifications/dm/${PEER}/mute`, {
    muted: true
  });
  assert.deepEqual([self.status, checked(Failure, self.body).error], [400, 'Invalid notification target']);
  const muteRefusals: Array<[string, number, string]> = [
    ['not_found', 404, 'Not found'],
    ['self', 400, 'Invalid notification target'],
    ['temporary_room', 403, 'Only saved rooms can be muted'],
    ['not_saved_room', 403, 'Room is not saved']
  ];
  for (const [status, code, error] of muteRefusals) {
    const response = await call(
      routeApp(t, { setRoomMute: { status, preferences: PRIVATE } }).app,
      'PUT',
      '/api/notifications/room/room-1/mute',
      { muted: true }
    );
    assert.deepEqual([response.status, checked(Failure, response.body, status).error], [code, error]);
  }
  const pushCases: Array<[Partial<Outcomes>, Method, number, string]> = [
    [{ subscribe: { status: 'disabled' } }, 'POST', 503, 'Push notifications are disabled'],
    [{ subscribe: { status: 'invalid' } }, 'POST', 400, 'Invalid push subscription'],
    [{ subscribe: { status: 'conflict' } }, 'POST', 409, 'Push endpoint belongs to another subscription'],
    [
      { subscribe: { status: 'rate_limited', retryAfterSeconds: 3 } },
      'POST',
      429,
      'Too many push subscription changes'
    ],
    [{ unsubscribe: { status: 'invalid' } }, 'DELETE', 400, 'Invalid push endpoint'],
    [
      { unsubscribe: { status: 'rate_limited', retryAfterSeconds: 3 } },
      'DELETE',
      429,
      'Too many push subscription changes'
    ]
  ];
  for (const [outcomes, method, status, error] of pushCases) {
    const response = await call(routeApp(t, outcomes).app, method, '/api/push/subscriptions', {});
    const what = JSON.stringify(outcomes);
    const body = checked(Failure, response.body, what);
    assert.deepEqual([response.status, body.error], [status, error], what);
    if (status === 429) assert.deepEqual([response.retryAfter, body.retryAfterSeconds], ['3', 3]);
  }
});
