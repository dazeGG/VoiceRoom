import { defineStore } from 'pinia';
import { onScopeDispose, reactive, toRefs, watch } from 'vue';
import {
  deletePushSubscription,
  fetchPushConfig,
  pushLocaleCapability,
  resetPushLocaleRegistration,
  savePushSubscription
} from '@/api/push';
import { isDesktopBoundaryBlocked } from '@/platform/desktop-boundary';
import { useLocaleStore } from '@/shared/i18n';
import { ApiError } from '@/api/client';

// Vite has no `$app/environment`: the runtime says whether this is a browser.
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!browser || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
}

export const usePushNotificationsStore = defineStore('push-notifications', () => {
  const locale = useLocaleStore();
  const pushNotifications = reactive<{
    active: boolean;
    busy: boolean;
    loaded: boolean;
    serverEnabled: boolean;
    supported: boolean;
    userId: string | null;
    localeSyncPending: boolean;
  }>({
    active: false,
    busy: false,
    loaded: false,
    serverEnabled: false,
    supported: false,
    userId: null,
    localeSyncPending: false
  });

  let syncGeneration = 0;
  let syncQueue: Promise<void> = Promise.resolve();
  let confirmedUserId: string | null = null;
  let confirmedEndpoint: string | null = null;

  function isDesktopRuntime(): boolean {
    return browser && Boolean(window.voiceRoomRuntime?.isDesktop);
  }

  function isPushSuppressedByPlatform(): boolean {
    return !browser || isDesktopRuntime() || isDesktopBoundaryBlocked();
  }

  function syncPushNotificationState(userId: string | null): Promise<void> {
    const generation = ++syncGeneration;
    syncQueue = syncQueue.catch(() => {}).then(() => syncPushNotificationStateNow(userId, generation));
    return syncQueue;
  }

  async function syncPushNotificationStateNow(userId: string | null, generation: number): Promise<void> {
    if (generation !== syncGeneration) return;
    if (pushNotifications.userId !== userId) {
      resetPushLocaleRegistration();
      confirmedUserId = null;
      confirmedEndpoint = null;
      pushNotifications.localeSyncPending = false;
      pushNotifications.active = false;
      pushNotifications.loaded = false;
      pushNotifications.userId = userId;
    }
    if (!userId) return;
    if (isDesktopRuntime()) {
      pushNotifications.supported = false;
      pushNotifications.serverEnabled = false;
      pushNotifications.active = false;
      pushNotifications.loaded = true;
      return;
    }
    if (!browser || isDesktopBoundaryBlocked()) {
      pushNotifications.supported = false;
      pushNotifications.serverEnabled = false;
      pushNotifications.active = false;
      pushNotifications.loaded = true;
      return;
    }
    pushNotifications.supported = Boolean(
      browser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    );
    if (!pushNotifications.supported) {
      pushNotifications.loaded = true;
      return;
    }
    try {
      const [config, registration] = await Promise.all([fetchPushConfig(), getRegistration()]);
      if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
      pushNotifications.serverEnabled = config.enabled;
      const subscription = await registration?.pushManager.getSubscription();
      if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
      if (subscription && config.enabled) {
        try {
          await savePushSubscription(
            subscription.toJSON(),
            () => generation === syncGeneration && pushNotifications.userId === userId
          );
          if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
          confirmedUserId = userId;
          confirmedEndpoint = subscription.endpoint;
          pushNotifications.localeSyncPending = locale.current !== 'ru' && pushLocaleCapability() === false;
        } catch (error) {
          if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
          const rejected =
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            !['push_registration_conflict', 'invalid_response', 'push_rate_limited', 'rate_limited'].includes(
              error.code
            );
          if (!rejected && confirmedUserId === userId && confirmedEndpoint === subscription.endpoint) {
            pushNotifications.localeSyncPending = true;
            pushNotifications.active = true;
            return;
          }
          // Never retain an unconfirmed endpoint that may still belong to the previous account.
          await subscription.unsubscribe().catch(() => false);
          throw new Error('Push subscription reconciliation failed', { cause: error });
        }
      }
      if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
      pushNotifications.active = Boolean(subscription && config.enabled);
    } catch {
      if (generation === syncGeneration && pushNotifications.userId === userId) {
        pushNotifications.serverEnabled = false;
        pushNotifications.active = false;
      }
    } finally {
      if (generation === syncGeneration && pushNotifications.userId === userId) pushNotifications.loaded = true;
    }
  }

  async function detachPushSubscription(): Promise<void> {
    syncGeneration += 1;
    if (!browser || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      try {
        await deletePushSubscription(subscription.endpoint);
      } finally {
        await subscription.unsubscribe();
      }
    } finally {
      pushNotifications.active = false;
      pushNotifications.userId = null;
      pushNotifications.localeSyncPending = false;
      confirmedUserId = null;
      confirmedEndpoint = null;
    }
  }

  async function setPushNotificationsEnabled(enabled: boolean): Promise<boolean> {
    if (isPushSuppressedByPlatform()) {
      pushNotifications.active = false;
      return false;
    }
    if (pushNotifications.busy) return pushNotifications.active;
    const generation = syncGeneration;
    const userId = pushNotifications.userId;
    const current = (): boolean => generation === syncGeneration && pushNotifications.userId === userId;
    pushNotifications.busy = true;
    try {
      const config = await fetchPushConfig();
      pushNotifications.serverEnabled = config.enabled;
      if (!config.enabled) throw new Error('Push notifications are disabled');
      const registration = await getRegistration();
      if (!registration) throw new Error('Push notifications are unsupported');
      const existing = await registration.pushManager.getSubscription();
      if (!enabled) {
        if (existing) {
          await deletePushSubscription(existing.endpoint);
          await existing.unsubscribe();
        }
        pushNotifications.active = false;
        pushNotifications.localeSyncPending = false;
        return false;
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted');
      let subscription =
        existing ||
        (await registration.pushManager.subscribe({
          applicationServerKey: decodeVapidKey(config.vapidPublicKey),
          userVisibleOnly: true
        }));
      try {
        await savePushSubscription(subscription.toJSON(), current);
      } catch (error) {
        await subscription.unsubscribe().catch(() => false);
        if (!existing) throw error;
        subscription = await registration.pushManager.subscribe({
          applicationServerKey: decodeVapidKey(config.vapidPublicKey),
          userVisibleOnly: true
        });
        try {
          await savePushSubscription(subscription.toJSON(), current);
        } catch (retryError) {
          await subscription.unsubscribe().catch(() => false);
          throw retryError;
        }
      }
      if (!current()) return false;
      pushNotifications.active = true;
      confirmedUserId = userId;
      confirmedEndpoint = subscription.endpoint;
      pushNotifications.localeSyncPending = locale.current !== 'ru' && pushLocaleCapability() === false;
      return true;
    } finally {
      pushNotifications.busy = false;
    }
  }

  watch(
    () => locale.current,
    () => {
      if (pushNotifications.userId) void syncPushNotificationState(pushNotifications.userId);
    }
  );

  const retryLocaleSync = (): void => {
    if (pushNotifications.userId && pushNotifications.localeSyncPending) {
      void syncPushNotificationState(pushNotifications.userId);
    }
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') retryLocaleSync();
  };
  if (browser) {
    window.addEventListener('online', retryLocaleSync);
    document.addEventListener('visibilitychange', onVisibility);
    onScopeDispose(() => {
      syncGeneration += 1;
      window.removeEventListener('online', retryLocaleSync);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  return {
    ...toRefs(pushNotifications),
    syncPushNotificationState,
    detachPushSubscription,
    setPushNotificationsEnabled
  };
});
