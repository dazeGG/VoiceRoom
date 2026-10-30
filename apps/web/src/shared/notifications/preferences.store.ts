/** Application-wide notification preferences shared by lobby and active-room UI. */
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
  fetchNotificationPreferences,
  setDmNotificationsMuted,
  setRoomNotificationsMuted,
  setPresenceStatus,
  setPrivateNotifications,
  type NotificationPreferences
} from '@/api/notifications';
import { normalizePresenceStatus, type PresenceStatus } from '@/shared/presence';
import {
  getNotificationDeliveryPermission,
  getNotificationPermission,
  requestNotificationPermissionFromUserAction,
  type NotificationPermissionState
} from '@/shared/notifications/router';
import { usePlaybackPolicyStore } from '@/shared/audio/playback-policy.store';

const NOTIFICATIONS_ENABLED_STORAGE_KEY = 'voice-room:notifications-enabled';

export const useNotificationPreferencesStore = defineStore('notification-preferences', () => {
  const playback = usePlaybackPolicyStore();

  const notificationPreferences = reactive<{
    loaded: boolean;
    loadedForUserId: string | null;
    loading: boolean;
    loadingForUserId: string | null;
    mutedPeerIds: string[];
    mutedRoomIds: string[];
    notificationsEnabled: boolean;
    presenceStatus: PresenceStatus;
    presenceStatusAutomatic: boolean;
    privateNotifications: boolean;
    doNotDisturb: boolean;
    browserPermission: NotificationPermissionState;
    deliveryPermission: NotificationPermissionState;
  }>({
    loaded: false,
    loadedForUserId: null,
    loading: false,
    loadingForUserId: null,
    mutedPeerIds: [],
    mutedRoomIds: [],
    notificationsEnabled: true,
    presenceStatus: 'online',
    presenceStatusAutomatic: false,
    privateNotifications: false,
    doNotDisturb: false,
    browserPermission: 'unsupported',
    deliveryPermission: 'unsupported'
  });

  let activeUserId: string | null = null;
  let preferenceGeneration = 0;

  function readNotificationsEnabled(): boolean {
    try {
      return localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  function setNotificationsEnabled(enabled: boolean): boolean {
    const value = Boolean(enabled);
    try {
      localStorage.setItem(NOTIFICATIONS_ENABLED_STORAGE_KEY, String(value));
    } catch {
      // Keep the in-memory state even when storage is unavailable.
    }
    notificationPreferences.notificationsEnabled = value;
    return value;
  }

  function applyPreferenceFields(preferences: NotificationPreferences): void {
    notificationPreferences.mutedPeerIds = [...preferences.mutedPeerIds];
    notificationPreferences.mutedRoomIds = [...preferences.mutedRoomIds];
    notificationPreferences.presenceStatus = normalizePresenceStatus(
      preferences.presenceStatus,
      preferences.doNotDisturb ? 'dnd' : 'online'
    );
    notificationPreferences.presenceStatusAutomatic =
      notificationPreferences.presenceStatus === 'away' && Boolean(preferences.presenceStatusAutomatic);
    notificationPreferences.privateNotifications = preferences.privateNotifications;
    notificationPreferences.doNotDisturb = preferences.doNotDisturb;
    playback.setDoNotDisturbPlaybackSuppressed(preferences.doNotDisturb);
  }

  function applyPreferences(preferences: NotificationPreferences, userId: string): void {
    applyPreferenceFields(preferences);
    notificationPreferences.loaded = true;
    notificationPreferences.loadedForUserId = userId;
  }

  function applyMutationPreferences(
    preferences: NotificationPreferences,
    userId: string | null,
    generation: number
  ): void {
    if (!userId || activeUserId !== userId || preferenceGeneration !== generation) return;
    applyPreferences(preferences, userId);
  }

  function resetNotificationPreferences(): void {
    preferenceGeneration += 1;
    activeUserId = null;
    notificationPreferences.loaded = false;
    notificationPreferences.loadedForUserId = null;
    notificationPreferences.loading = false;
    notificationPreferences.loadingForUserId = null;
    notificationPreferences.mutedPeerIds = [];
    notificationPreferences.mutedRoomIds = [];
    notificationPreferences.presenceStatus = 'online';
    notificationPreferences.presenceStatusAutomatic = false;
    notificationPreferences.privateNotifications = false;
    notificationPreferences.doNotDisturb = false;
    playback.setDoNotDisturbPlaybackSuppressed(false);
    syncNotificationPermission();
  }

  function prepareNotificationPreferences(userId: string, doNotDisturb: boolean, presenceStatus?: unknown): void {
    resetNotificationPreferences();
    activeUserId = userId;
    notificationPreferences.presenceStatus = normalizePresenceStatus(presenceStatus, doNotDisturb ? 'dnd' : 'online');
    notificationPreferences.presenceStatusAutomatic = false;
    notificationPreferences.doNotDisturb = Boolean(doNotDisturb);
    playback.setDoNotDisturbPlaybackSuppressed(doNotDisturb);
  }

  function applyRealtimeNotificationPreferences(userId: string, preferences: NotificationPreferences): void {
    if (activeUserId !== userId) return;
    preferenceGeneration += 1;
    notificationPreferences.loading = false;
    notificationPreferences.loadingForUserId = null;
    applyPreferences(preferences, userId);
  }

  function areNotificationPreferencesLoadedFor(userId: string): boolean {
    return notificationPreferences.loaded && notificationPreferences.loadedForUserId === userId;
  }

  function syncNotificationPermission(): void {
    notificationPreferences.browserPermission = getNotificationPermission();
    notificationPreferences.deliveryPermission = getNotificationDeliveryPermission();
    notificationPreferences.notificationsEnabled = readNotificationsEnabled();
  }

  async function loadNotificationPreferences(userId: string): Promise<void> {
    if (areNotificationPreferencesLoadedFor(userId)) return;
    if (notificationPreferences.loading) {
      if (notificationPreferences.loadingForUserId === userId) return;
      throw new Error('notification preferences load already in progress for another user');
    }
    if (activeUserId !== userId) prepareNotificationPreferences(userId, false);
    const generation = preferenceGeneration;
    notificationPreferences.loading = true;
    notificationPreferences.loadingForUserId = userId;
    syncNotificationPermission();
    try {
      const preferences = await fetchNotificationPreferences();
      if (
        activeUserId === userId &&
        preferenceGeneration === generation &&
        notificationPreferences.loadingForUserId === userId
      ) {
        applyPreferences(preferences, userId);
      }
    } finally {
      if (
        activeUserId === userId &&
        preferenceGeneration === generation &&
        notificationPreferences.loadingForUserId === userId
      ) {
        notificationPreferences.loading = false;
        notificationPreferences.loadingForUserId = null;
      }
    }
  }

  function isPeerNotificationsMuted(userId: string | null | undefined): boolean {
    return Boolean(userId && notificationPreferences.mutedPeerIds.includes(userId));
  }

  function isRoomNotificationsMuted(roomId: string | null | undefined): boolean {
    return Boolean(roomId && notificationPreferences.mutedRoomIds.includes(roomId));
  }

  async function updatePeerNotificationsMuted(userId: string, muted: boolean): Promise<void> {
    const accountUserId = activeUserId;
    const generation = preferenceGeneration;
    const payload = await setDmNotificationsMuted(userId, muted);
    applyMutationPreferences(payload.preferences, accountUserId, generation);
  }

  async function updateRoomNotificationsMuted(roomId: string, muted: boolean): Promise<void> {
    if (!roomId) return;
    const accountUserId = activeUserId;
    const generation = preferenceGeneration;
    const payload = await setRoomNotificationsMuted(roomId, muted);
    applyMutationPreferences(payload.preferences, accountUserId, generation);
  }

  async function updatePrivateNotifications(privateNotifications: boolean): Promise<void> {
    const accountUserId = activeUserId;
    const generation = preferenceGeneration;
    const payload = await setPrivateNotifications(privateNotifications);
    applyMutationPreferences(payload.preferences, accountUserId, generation);
  }

  async function updatePresenceStatus(status: PresenceStatus): Promise<void> {
    const accountUserId = activeUserId;
    const generation = preferenceGeneration;
    const payload = await setPresenceStatus(status);
    applyMutationPreferences(payload.preferences, accountUserId, generation);
  }

  async function updateAutomaticPresenceStatus(status: 'online' | 'away'): Promise<void> {
    const accountUserId = activeUserId;
    const generation = preferenceGeneration;
    const payload = await setPresenceStatus(status, true);
    applyMutationPreferences(payload.preferences, accountUserId, generation);
  }

  async function requestNotificationsFromUiAction(): Promise<NotificationPermissionState> {
    await requestNotificationPermissionFromUserAction();
    syncNotificationPermission();
    if (notificationPreferences.deliveryPermission === 'granted') setNotificationsEnabled(true);
    return notificationPreferences.deliveryPermission;
  }

  return {
    notificationPreferences,
    setNotificationsEnabled,
    resetNotificationPreferences,
    prepareNotificationPreferences,
    applyRealtimeNotificationPreferences,
    areNotificationPreferencesLoadedFor,
    syncNotificationPermission,
    loadNotificationPreferences,
    isPeerNotificationsMuted,
    isRoomNotificationsMuted,
    updatePeerNotificationsMuted,
    updateRoomNotificationsMuted,
    updatePrivateNotifications,
    updatePresenceStatus,
    updateAutomaticPresenceStatus,
    requestNotificationsFromUiAction
  };
});
