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
  return { subscription, pushManager };
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
