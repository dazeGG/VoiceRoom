// Web Push: turning it on subscribes this browser and tells the server,
// turning it off or signing out removes the subscription on both sides.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { freshImport, stubWindow } from '../helpers/fresh-module.ts';
import { useLocaleStore } from '@/shared/i18n';

function fakePushManager(existing: boolean) {
  const subscription = {
    endpoint: 'https://push.example/sub-1',
    toJSON: () => ({ endpoint: 'https://push.example/sub-1', keys: { p256dh: 'k', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true)
  };
  const pushManager = {
    getSubscription: vi.fn(async () => (existing ? subscription : null)),
    subscribe: vi.fn(async () => subscription)
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) }
  });
  stubWindow({ PushManager: class {} });
  return { subscription, pushManager, registration, serviceWorker: navigator.serviceWorker };
}

function stubNotification(permission: NotificationPermission, requested: NotificationPermission = permission) {
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => requested) });
}

const load = async () => {
  const module = await freshImport(() => import('../../src/features/home/model/push-notifications.store.ts'));
  return module.usePushNotificationsStore();
};

beforeEach(() => stubNotification('granted'));
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

test('turning push on subscribes this browser with the server key and saves the subscription', async () => {
  const { pushManager } = fakePushManager(false);
  const { calls } = stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();

  await expect(push.setPushNotificationsEnabled(true)).resolves.toBe(true);
  expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(calls.at(-1)).toMatchObject({
    method: 'POST',
    url: '/api/push/subscriptions',
    body: { subscription: { endpoint: 'https://push.example/sub-1' } }
  });
  expect(push.active).toBe(true);
});

test('a refused browser permission leaves push off', async () => {
  stubNotification('default', 'denied');
  fakePushManager(false);
  stubFetch({ '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } } });
  const push = await load();
  await expect(push.setPushNotificationsEnabled(true)).rejects.toThrow('Notification permission was not granted');
  expect(push.active).toBe(false);
});

test('turning push off removes the subscription on the server and in the browser', async () => {
  const { subscription } = fakePushManager(true);
  const { calls } = stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'DELETE /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await expect(push.setPushNotificationsEnabled(false)).resolves.toBe(false);
  expect(calls.at(-1)).toMatchObject({
    method: 'DELETE',
    url: '/api/push/subscriptions',
    body: { endpoint: 'https://push.example/sub-1' }
  });
  expect(subscription.unsubscribe).toHaveBeenCalled();
});

test("signing out detaches this browser's subscription", async () => {
  const { subscription } = fakePushManager(true);
  const { calls } = stubFetch({ 'DELETE /api/push/subscriptions': { body: { ok: true } } });
  const push = await load();
  await push.detachPushSubscription();
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['DELETE /api/push/subscriptions']);
  expect(subscription.unsubscribe).toHaveBeenCalled();
  expect(push.userId).toBeNull();
});

test('the desktop app never uses Web Push', async () => {
  fakePushManager(false);
  stubWindow({ voiceRoomRuntime: { isDesktop: true } });
  const { calls } = stubFetch({});
  const push = await load();
  await expect(push.setPushNotificationsEnabled(true)).resolves.toBe(false);
  expect(calls).toEqual([]);
});

test('an offline language change keeps a confirmed subscription and syncs current language on reconnect', async () => {
  const { subscription } = fakePushManager(true);
  let offline = false;
  let serverLocale = 'ru';
  const { calls } = stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': () => {
      if (offline) throw new TypeError('offline');
      return {
        status: 201,
        body: {
          ok: true,
          registration: { protocol: 1, locale: serverLocale, version: '11111111-1111-4111-8111-111111111111' }
        }
      };
    }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  expect(push.active).toBe(true);
  offline = true;
  await useLocaleStore().select('fr');
  await vi.waitFor(() => expect(push.localeSyncPending).toBe(true));
  expect(push.active).toBe(true);
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  offline = false;
  serverLocale = 'fr';
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(push.localeSyncPending).toBe(false));
  expect(calls.at(-1)?.body).toMatchObject({ localeState: { locale: 'fr' } });
  push.$dispose();
});

test('an unconfirmed endpoint is detached if a new account cannot reconcile ownership', async () => {
  const { subscription } = fakePushManager(true);
  stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': () => {
      throw new TypeError('offline');
    }
  });
  const push = await load();
  await push.syncPushNotificationState('new-account');
  expect(subscription.unsubscribe).toHaveBeenCalled();
  expect(push.active).toBe(false);
  push.$dispose();
});

for (const failure of ['config', 'registration', 'subscription'] as const) {
  test(`confirmed locale sync survives offline prefetch failure: ${failure}`, async () => {
    const { subscription, pushManager, serviceWorker } = fakePushManager(true);
    let offline = false;
    const { calls } = stubFetch({
      '/api/push/config': () => {
        if (offline && failure === 'config') throw new TypeError('offline config');
        return { body: { enabled: true, vapidPublicKey: 'BAAA' } };
      },
      'POST /api/push/subscriptions': () => ({
        status: 201,
        body: {
          ok: true,
          registration: {
            protocol: 1,
            locale: useLocaleStore().current,
            version: '11111111-1111-4111-8111-111111111111'
          }
        }
      })
    });
    const push = await load();
    await push.syncPushNotificationState('alice');
    if (failure === 'registration')
      vi.spyOn(serviceWorker, 'register').mockRejectedValueOnce(new TypeError('offline SW'));
    if (failure === 'subscription')
      pushManager.getSubscription.mockRejectedValueOnce(new TypeError('offline subscription'));
    offline = true;
    await useLocaleStore().select('fr');
    await vi.waitFor(() => expect(push.localeSyncPending).toBe(true));
    expect(push.active).toBe(true);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    offline = false;
    const before = calls.filter((call) => call.method === 'POST').length;
    if (failure === 'subscription') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    } else window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'POST').length).toBeGreaterThan(before));
    await vi.waitFor(() => expect(push.localeSyncPending).toBe(false));
    expect(calls.at(-1)?.body).toMatchObject({ localeState: { locale: 'fr' } });
    push.$dispose();
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('auth change fences a delayed offline prefetch and never retains the previous confirmation', async () => {
  const { subscription, serviceWorker } = fakePushManager(true);
  stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  const pending = deferred<ServiceWorkerRegistration>();
  const register = vi
    .spyOn(serviceWorker, 'register')
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new TypeError('offline'));
  const old = push.syncPushNotificationState('alice');
  await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  const next = push.syncPushNotificationState('bob');
  expect(push.userId).toBe('bob');
  expect(push.active).toBe(false);
  pending.reject(new TypeError('late offline'));
  await Promise.all([old, next]);
  expect(push.userId).toBe('bob');
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  push.$dispose();
});

test('logout during delayed prefetch cannot restore a confirmed target or schedule a retry', async () => {
  const { serviceWorker } = fakePushManager(true);
  const { calls } = stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } },
    'DELETE /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  const pending = deferred<ServiceWorkerRegistration>();
  const register = vi.spyOn(serviceWorker, 'register').mockReturnValueOnce(pending.promise);
  const syncing = push.syncPushNotificationState('alice');
  await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  await push.detachPushSubscription();
  pending.reject(new TypeError('late offline'));
  await syncing;
  const count = calls.length;
  window.dispatchEvent(new Event('online'));
  expect(push.userId).toBeNull();
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(calls).toHaveLength(count);
  push.$dispose();
});

test('a replacement endpoint cannot inherit confirmation after an in-flight prefetch failure', async () => {
  const { subscription, pushManager, serviceWorker } = fakePushManager(true);
  let offline = false;
  stubFetch({
    '/api/push/config': () => {
      if (offline) throw new TypeError('offline');
      return { body: { enabled: true, vapidPublicKey: 'BAAA' } };
    },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  const pending = deferred<ServiceWorkerRegistration>();
  const register = vi.spyOn(serviceWorker, 'register').mockReturnValueOnce(pending.promise);
  offline = true;
  const syncing = push.syncPushNotificationState('alice');
  await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  const replacement = {
    ...subscription,
    endpoint: 'https://push.example/replacement',
    unsubscribe: vi.fn(async () => true)
  };
  pushManager.getSubscription.mockResolvedValue(replacement);
  pending.resolve((await serviceWorker.getRegistration()) ?? (await serviceWorker.ready));
  await syncing;
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(replacement.unsubscribe).toHaveBeenCalled();
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  push.$dispose();
});

test('a config authentication rejection invalidates a previously confirmed target', async () => {
  const { subscription } = fakePushManager(true);
  let rejected = false;
  stubFetch({
    '/api/push/config': () =>
      rejected
        ? { status: 401, body: { ok: false, code: 'authentication_required' } }
        : { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  rejected = true;
  await push.syncPushNotificationState('alice');
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(subscription.unsubscribe).toHaveBeenCalled();
  push.$dispose();
});

test('an unconfirmed target is detached when config prefetch fails', async () => {
  const { subscription } = fakePushManager(true);
  stubFetch({
    '/api/push/config': () => {
      throw new TypeError('offline config');
    }
  });
  const push = await load();
  await push.syncPushNotificationState('bob');
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(subscription.unsubscribe).toHaveBeenCalled();
  push.$dispose();
});

test('an endpoint replaced during POST cannot inherit confirmation on a transient rejection', async () => {
  const { subscription, pushManager } = fakePushManager(true);
  const { fetchMock } = stubFetch({
    '/api/push/config': { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  const pending = deferred<Response>();
  const original = fetchMock.getMockImplementation();
  if (!original) throw new Error('missing fetch fixture');
  fetchMock.mockImplementation((input, init) => (init?.method === 'POST' ? pending.promise : original(input, init)));
  const syncing = push.syncPushNotificationState('alice');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  const replacement = {
    ...subscription,
    endpoint: 'https://push.example/replacement',
    unsubscribe: vi.fn(async () => true)
  };
  pushManager.getSubscription.mockResolvedValue(replacement);
  pending.reject(new TypeError('offline POST'));
  await syncing;
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  expect(replacement.unsubscribe).toHaveBeenCalled();
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  push.$dispose();
});

test('an auth config rejection wins over a simultaneous subscription read failure', async () => {
  const { pushManager } = fakePushManager(true);
  let rejected = false;
  stubFetch({
    '/api/push/config': () =>
      rejected
        ? { status: 403, body: { ok: false, code: 'forbidden' } }
        : { body: { enabled: true, vapidPublicKey: 'BAAA' } },
    'POST /api/push/subscriptions': { body: { ok: true } }
  });
  const push = await load();
  await push.syncPushNotificationState('alice');
  rejected = true;
  pushManager.getSubscription.mockRejectedValueOnce(new TypeError('offline subscription'));
  await push.syncPushNotificationState('alice');
  expect(push.active).toBe(false);
  expect(push.localeSyncPending).toBe(false);
  push.$dispose();
});
