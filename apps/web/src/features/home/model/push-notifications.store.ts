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

// Keep rejected I/O values unknown instead of PromiseRejectedResult.reason's any.
async function settle<T>(
  operation: Promise<T>
): Promise<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }> {
  try {
    return { status: 'fulfilled', value: await operation };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
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
    // Invalidate the old identity immediately, before queued network work settles.
    if (pushNotifications.userId !== userId) {
      resetPushLocaleRegistration();
      confirmedUserId = null;
      confirmedEndpoint = null;
      pushNotifications.localeSyncPending = false;
      pushNotifications.active = false;
      pushNotifications.loaded = false;
      pushNotifications.userId = userId;
    }
    syncQueue = syncQueue.catch(() => {}).then(() => syncPushNotificationStateNow(userId, generation));
    return syncQueue;
  }

  async function syncPushNotificationStateNow(userId: string | null, generation: number): Promise<void> {
    if (generation !== syncGeneration || pushNotifications.userId !== userId) return;
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
    let subscription: PushSubscription | null | undefined;
    let registration: ServiceWorkerRegistration | null = null;
    const current = (): boolean => generation === syncGeneration && pushNotifications.userId === userId;
    const rejectTarget = (): void => {
      confirmedUserId = null;
      confirmedEndpoint = null;
      pushNotifications.active = false;
      pushNotifications.localeSyncPending = false;
    };
    try {
      // Inspect the browser target even when config fails, so a replaced endpoint
      // cannot inherit confirmation from the subscription previously registered.
      const [configResult, registrationResult] = await Promise.all([
        settle(fetchPushConfig()),
        settle(getRegistration())
      ]);
      if (!current()) return;
      if (registrationResult.status === 'fulfilled') {
        registration = registrationResult.value;
        try {
          subscription = (await registration?.pushManager.getSubscription()) ?? null;
        } catch (error) {
          // A simultaneous config auth refusal takes precedence over browser I/O.
          if (configResult.status === 'rejected') throw configResult.reason;
          throw error;
        }
        if (!current()) return;
        if (subscription?.endpoint !== confirmedEndpoint) rejectTarget();
      }
      if (configResult.status === 'rejected') throw configResult.reason;
      if (registrationResult.status === 'rejected') throw registrationResult.reason;
      const config = configResult.value;
      pushNotifications.serverEnabled = config.enabled;
      if (subscription && config.enabled) {
        await savePushSubscription(subscription.toJSON(), current);
        if (!current()) return;
        const latest = await registration?.pushManager.getSubscription();
        if (!current()) return;
        if (latest?.endpoint !== subscription.endpoint) {
          rejectTarget();
          pushNotifications.localeSyncPending = true;
          return;
        }
        confirmedUserId = userId;
        confirmedEndpoint = subscription.endpoint;
        pushNotifications.localeSyncPending = locale.current !== 'ru' && pushLocaleCapability() === false;
      } else {
        rejectTarget();
      }
      pushNotifications.active = Boolean(subscription && config.enabled);
    } catch (error) {
      if (!current()) return;
      // A definitive refusal is never an offline retry, including config 401/403.
      const rejected =
        error instanceof ApiError &&
        (error.status === 401 ||
          error.status === 403 ||
          (error.status >= 400 &&
            error.status < 500 &&
            !['push_registration_conflict', 'invalid_response', 'push_rate_limited', 'rate_limited'].includes(
              error.code
            )));
      // Re-read after POST: the endpoint may have changed while it was in flight.
      if (subscription && registration) {
        try {
          const latest = await registration.pushManager.getSubscription();
          if (!current()) return;
          subscription = latest;
          if (subscription?.endpoint !== confirmedEndpoint) rejectTarget();
        } catch {
          if (!current()) return;
        }
      }
      const sameConfirmedTarget =
        confirmedUserId === userId &&
        confirmedEndpoint !== null &&
        (subscription === undefined || subscription?.endpoint === confirmedEndpoint);
      if (!rejected && sameConfirmedTarget) {
        pushNotifications.localeSyncPending = true;
        pushNotifications.active = true;
        return;
      }
      rejectTarget();
      pushNotifications.serverEnabled = false;
      // Never retain an unconfirmed endpoint that may belong to another account.
      if (subscription) await subscription.unsubscribe().catch(() => false);
    } finally {
      if (current()) pushNotifications.loaded = true;
    }
  }

  async function detachPushSubscription(): Promise<void> {
    const generation = ++syncGeneration;
    pushNotifications.active = false;
    pushNotifications.userId = null;
    pushNotifications.localeSyncPending = false;
    confirmedUserId = null;
    confirmedEndpoint = null;
    resetPushLocaleRegistration();
    if (!browser || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (generation !== syncGeneration) return;
      const subscription = await registration?.pushManager.getSubscription();
      if (generation !== syncGeneration || !subscription) return;
      try {
        await deletePushSubscription(subscription.endpoint);
      } finally {
        if (generation === syncGeneration) await subscription.unsubscribe();
      }
    } finally {
      if (generation === syncGeneration) {
        pushNotifications.active = false;
        pushNotifications.userId = null;
        pushNotifications.localeSyncPending = false;
        confirmedUserId = null;
        confirmedEndpoint = null;
      }
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
