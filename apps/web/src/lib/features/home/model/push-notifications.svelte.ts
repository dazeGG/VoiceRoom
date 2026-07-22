import { browser } from '$app/environment';
import { deletePushSubscription, fetchPushConfig, savePushSubscription } from '$lib/api/push';
import { isDesktopBoundaryBlocked } from '$lib/platform/desktop-boundary';

export const pushNotifications = $state({
  active: false,
  busy: false,
  loaded: false,
  serverEnabled: false,
  supported: false,
  userId: null as string | null
});

let syncGeneration = 0;
let syncQueue: Promise<void> = Promise.resolve();

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

function isDesktopRuntime(): boolean {
  return browser && Boolean(window.voiceRoomRuntime?.isDesktop);
}

function isPushSuppressedByPlatform(): boolean {
  return !browser || isDesktopRuntime() || isDesktopBoundaryBlocked();
}

export function syncPushNotificationState(userId: string | null): Promise<void> {
  const generation = ++syncGeneration;
  syncQueue = syncQueue.catch(() => {}).then(() => syncPushNotificationStateNow(userId, generation));
  return syncQueue;
}

async function syncPushNotificationStateNow(userId: string | null, generation: number): Promise<void> {
  if (generation !== syncGeneration) return;
  if (pushNotifications.userId !== userId) {
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
        await savePushSubscription(subscription.toJSON());
      } catch {
        await subscription.unsubscribe().catch(() => false);
        throw new Error('Push subscription reconciliation failed');
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

export async function detachPushSubscription(): Promise<void> {
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
  }
}

export async function setPushNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (isPushSuppressedByPlatform()) {
    pushNotifications.active = false;
    return false;
  }
  if (pushNotifications.busy) return pushNotifications.active;
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
      return false;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted');
    let subscription = existing || await registration.pushManager.subscribe({
      applicationServerKey: decodeVapidKey(config.vapidPublicKey),
      userVisibleOnly: true
    });
    try {
      await savePushSubscription(subscription.toJSON());
    } catch (error) {
      await subscription.unsubscribe().catch(() => false);
      if (!existing) throw error;
      subscription = await registration.pushManager.subscribe({
        applicationServerKey: decodeVapidKey(config.vapidPublicKey),
        userVisibleOnly: true
      });
      try {
        await savePushSubscription(subscription.toJSON());
      } catch (retryError) {
        await subscription.unsubscribe().catch(() => false);
        throw retryError;
      }
    }
    pushNotifications.active = true;
    return true;
  } finally {
    pushNotifications.busy = false;
  }
}
