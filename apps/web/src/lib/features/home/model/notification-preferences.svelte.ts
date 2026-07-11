import {
  fetchNotificationPreferences,
  setDmNotificationsMuted,
  setPrivateNotifications,
  setRoomNotificationsMuted,
  type NotificationPreferences
} from '$lib/api/notifications';
import {
  getNotificationDeliveryPermission,
  getNotificationPermission,
  requestNotificationPermissionFromUserAction,
  type NotificationPermissionState
} from '$lib/shared/notifications/router';

export const notificationPreferences = $state<{
  loaded: boolean;
  loadedForUserId: string | null;
  loading: boolean;
  loadingForUserId: string | null;
  mutedPeerIds: string[];
  mutedRoomIds: string[];
  privateNotifications: boolean;
  browserPermission: NotificationPermissionState;
  deliveryPermission: NotificationPermissionState;
}>({
  loaded: false,
  loadedForUserId: null,
  loading: false,
  loadingForUserId: null,
  mutedPeerIds: [],
  mutedRoomIds: [],
  privateNotifications: false,
  browserPermission: 'unsupported',
  deliveryPermission: 'unsupported'
});

function applyPreferenceFields(preferences: NotificationPreferences): void {
  notificationPreferences.mutedPeerIds = [...preferences.mutedPeerIds];
  notificationPreferences.mutedRoomIds = [...preferences.mutedRoomIds];
  notificationPreferences.privateNotifications = preferences.privateNotifications;
}

function applyPreferences(preferences: NotificationPreferences, userId: string): void {
  applyPreferenceFields(preferences);
  notificationPreferences.loaded = true;
  notificationPreferences.loadedForUserId = userId;
}

function applyMutationPreferences(preferences: NotificationPreferences): void {
  if (notificationPreferences.loadedForUserId) {
    applyPreferences(preferences, notificationPreferences.loadedForUserId);
    return;
  }
  applyPreferenceFields(preferences);
}

export function resetNotificationPreferences(): void {
  notificationPreferences.loaded = false;
  notificationPreferences.loadedForUserId = null;
  notificationPreferences.loading = false;
  notificationPreferences.loadingForUserId = null;
  notificationPreferences.mutedPeerIds = [];
  notificationPreferences.mutedRoomIds = [];
  notificationPreferences.privateNotifications = false;
  syncNotificationPermission();
}

export function areNotificationPreferencesLoadedFor(userId: string): boolean {
  return notificationPreferences.loaded && notificationPreferences.loadedForUserId === userId;
}

export function syncNotificationPermission(): void {
  notificationPreferences.browserPermission = getNotificationPermission();
  notificationPreferences.deliveryPermission = getNotificationDeliveryPermission();
}

export async function loadNotificationPreferences(userId: string): Promise<void> {
  if (areNotificationPreferencesLoadedFor(userId)) return;
  if (notificationPreferences.loading) {
    if (notificationPreferences.loadingForUserId === userId) return;
    throw new Error('notification preferences load already in progress for another user');
  }
  if (notificationPreferences.loadedForUserId && notificationPreferences.loadedForUserId !== userId) {
    resetNotificationPreferences();
  }
  notificationPreferences.loading = true;
  notificationPreferences.loadingForUserId = userId;
  syncNotificationPermission();
  try {
    const preferences = await fetchNotificationPreferences();
    if (notificationPreferences.loadingForUserId === userId) {
      applyPreferences(preferences, userId);
    }
  } finally {
    if (notificationPreferences.loadingForUserId === userId) {
      notificationPreferences.loading = false;
      notificationPreferences.loadingForUserId = null;
    }
  }
}

export function isPeerNotificationsMuted(userId: string | null | undefined): boolean {
  return Boolean(userId && notificationPreferences.mutedPeerIds.includes(userId));
}

export function isRoomNotificationsMuted(roomId: string | null | undefined): boolean {
  return Boolean(roomId && notificationPreferences.mutedRoomIds.includes(roomId));
}

export async function updatePeerNotificationsMuted(userId: string, muted: boolean): Promise<void> {
  const payload = await setDmNotificationsMuted(userId, muted);
  applyMutationPreferences(payload.preferences);
}

export async function updateRoomNotificationsMuted(roomId: string, muted: boolean): Promise<void> {
  const payload = await setRoomNotificationsMuted(roomId, muted);
  applyMutationPreferences(payload.preferences);
}

export async function updatePrivateNotifications(privateNotifications: boolean): Promise<void> {
  const payload = await setPrivateNotifications(privateNotifications);
  applyMutationPreferences(payload.preferences);
}

export async function requestNotificationsFromUiAction(): Promise<NotificationPermissionState> {
  await requestNotificationPermissionFromUserAction();
  syncNotificationPermission();
  return notificationPreferences.deliveryPermission;
}
