import {
  fetchNotificationPreferences,
  setDoNotDisturb,
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
  privateNotifications: false,
  doNotDisturb: false,
  browserPermission: 'unsupported',
  deliveryPermission: 'unsupported'
});

let activeUserId: string | null = null;
let preferenceGeneration = 0;

function applyPreferenceFields(preferences: NotificationPreferences): void {
  notificationPreferences.mutedPeerIds = [...preferences.mutedPeerIds];
  notificationPreferences.mutedRoomIds = [...preferences.mutedRoomIds];
  notificationPreferences.privateNotifications = preferences.privateNotifications;
  notificationPreferences.doNotDisturb = preferences.doNotDisturb;
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

export function resetNotificationPreferences(): void {
  preferenceGeneration += 1;
  activeUserId = null;
  notificationPreferences.loaded = false;
  notificationPreferences.loadedForUserId = null;
  notificationPreferences.loading = false;
  notificationPreferences.loadingForUserId = null;
  notificationPreferences.mutedPeerIds = [];
  notificationPreferences.mutedRoomIds = [];
  notificationPreferences.privateNotifications = false;
  notificationPreferences.doNotDisturb = false;
  syncNotificationPermission();
}

export function prepareNotificationPreferences(userId: string, doNotDisturb: boolean): void {
  resetNotificationPreferences();
  activeUserId = userId;
  notificationPreferences.doNotDisturb = Boolean(doNotDisturb);
}

export function applyRealtimeNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences
): void {
  if (activeUserId !== userId) return;
  preferenceGeneration += 1;
  notificationPreferences.loading = false;
  notificationPreferences.loadingForUserId = null;
  applyPreferences(preferences, userId);
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

export function isPeerNotificationsMuted(userId: string | null | undefined): boolean {
  return Boolean(userId && notificationPreferences.mutedPeerIds.includes(userId));
}

export function isRoomNotificationsMuted(roomId: string | null | undefined): boolean {
  return Boolean(roomId && notificationPreferences.mutedRoomIds.includes(roomId));
}

export async function updatePeerNotificationsMuted(userId: string, muted: boolean): Promise<void> {
  const accountUserId = activeUserId;
  const generation = preferenceGeneration;
  const payload = await setDmNotificationsMuted(userId, muted);
  applyMutationPreferences(payload.preferences, accountUserId, generation);
}

export async function updateRoomNotificationsMuted(roomId: string, muted: boolean): Promise<void> {
  const accountUserId = activeUserId;
  const generation = preferenceGeneration;
  const payload = await setRoomNotificationsMuted(roomId, muted);
  applyMutationPreferences(payload.preferences, accountUserId, generation);
}

export async function updatePrivateNotifications(privateNotifications: boolean): Promise<void> {
  const accountUserId = activeUserId;
  const generation = preferenceGeneration;
  const payload = await setPrivateNotifications(privateNotifications);
  applyMutationPreferences(payload.preferences, accountUserId, generation);
}

export async function updateDoNotDisturb(doNotDisturb: boolean): Promise<void> {
  const accountUserId = activeUserId;
  const generation = preferenceGeneration;
  const payload = await setDoNotDisturb(doNotDisturb);
  applyMutationPreferences(payload.preferences, accountUserId, generation);
}

export function isDoNotDisturbEnabled(): boolean {
  return notificationPreferences.doNotDisturb;
}

export async function requestNotificationsFromUiAction(): Promise<NotificationPermissionState> {
  await requestNotificationPermissionFromUserAction();
  syncNotificationPermission();
  return notificationPreferences.deliveryPermission;
}
