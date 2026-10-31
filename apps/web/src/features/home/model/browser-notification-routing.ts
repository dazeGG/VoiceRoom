// Realtime notification events become browser notifications once the
// account's notification preferences are known. Events that arrive before
// that wait (briefly, and a bounded number of them); preferences that fail to
// load are retried.

import type { RealtimeEvent } from '@/api/realtime';
import {
  canUseNotifications,
  getNotificationDeliveryPermission,
  routeNotificationEvent,
  showBrowserNotification,
  type NotificationActiveTarget
} from '@/shared/notifications/router';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';

const MAX_PENDING_EVENTS = 100;
const PENDING_TTL_MS = 60_000;
const PREFERENCES_RETRY_MS = 5000;

export class BrowserNotificationRouting {
  #userId = '';
  #pending: Array<{ event: RealtimeEvent; receivedAt: number }> = [];
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #activeTarget: () => NotificationActiveTarget | null;

  /** `activeTarget` is the chat being read now; its own events do not notify. */
  constructor(activeTarget: () => NotificationActiveTarget | null) {
    this.#activeTarget = activeTarget;
  }

  /** Starts for an account: loads its preferences, retrying until they arrive. */
  start(userId: string): void {
    this.#userId = userId;
    this.#loadPreferences();
  }

  /** Handles a `notification.*` event; answers false for any other event. */
  handle = (event: RealtimeEvent): boolean => {
    if (!event.type.startsWith('notification.')) return false;
    const preferences = useNotificationPreferencesStore();
    const { notificationPreferences } = preferences;
    if (!preferences.areNotificationPreferencesLoadedFor(this.#userId)) {
      const now = Date.now();
      this.#pending = this.#pending
        .filter((entry) => now - entry.receivedAt <= PENDING_TTL_MS)
        .slice(-(MAX_PENDING_EVENTS - 1));
      this.#pending.push({ event, receivedAt: now });
      return true;
    }
    preferences.syncNotificationPermission();
    const routed = routeNotificationEvent(event, {
      userId: this.#userId,
      activeTarget: this.#activeTarget(),
      mutedPeerIds: notificationPreferences.mutedPeerIds,
      mutedRoomIds: notificationPreferences.mutedRoomIds,
      privateNotifications: notificationPreferences.privateNotifications,
      doNotDisturb: notificationPreferences.doNotDisturb,
      notificationsAvailable: canUseNotifications() && notificationPreferences.notificationsEnabled,
      permission: getNotificationDeliveryPermission()
    });
    if (routed.notify) void showBrowserNotification(routed.payload);
    return true;
  };

  /** Preferences arrived (loaded or pushed live): deliver what waited for them. */
  flush = (): void => {
    if (
      !useNotificationPreferencesStore().areNotificationPreferencesLoadedFor(this.#userId) ||
      this.#pending.length === 0
    )
      return;
    const now = Date.now();
    const events = this.#pending
      .filter((entry) => now - entry.receivedAt <= PENDING_TTL_MS)
      .map((entry) => entry.event);
    this.#pending = [];
    for (const event of events) this.handle(event);
  };

  stop(): void {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#pending = [];
  }

  #loadPreferences(): void {
    const userId = this.#userId;
    const preferences = useNotificationPreferencesStore();
    if (preferences.areNotificationPreferencesLoadedFor(userId) || this.#retryTimer) return;
    void preferences
      .loadNotificationPreferences(userId)
      .then(this.flush)
      .catch(() => {
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = null;
          this.#loadPreferences();
        }, PREFERENCES_RETRY_MS);
      });
  }
}
