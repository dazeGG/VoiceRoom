import { getJsonAuth, postJsonAuth, putJson } from './http';
import { normalizePresenceStatus, type PresenceStatus } from '$lib/shared/presence';

export interface NotificationPreferences {
  doNotDisturb: boolean;
  mutedPeerIds: string[];
  mutedRoomIds: string[];
  presenceStatus: PresenceStatus;
  presenceStatusAutomatic: boolean;
  privateNotifications: boolean;
}

export type NotificationPreferencesResponse = {
  ok: true;
  preferences: NotificationPreferences;
};

export type NotificationMuteResponse = {
  ok: true;
  muted: boolean;
  preferences: NotificationPreferences;
};

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const payload = await getJsonAuth<NotificationPreferencesResponse>('/api/notifications/preferences');
  return normalizePreferences(payload.preferences);
}

export async function setDmNotificationsMuted(userId: string, muted: boolean): Promise<NotificationMuteResponse> {
  const payload = await putJson<NotificationMuteResponse>(`/api/notifications/dm/${encodeURIComponent(userId)}/mute`, { muted });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function setRoomNotificationsMuted(roomId: string, muted: boolean): Promise<NotificationMuteResponse> {
  const payload = await putJson<NotificationMuteResponse>(`/api/notifications/room/${encodeURIComponent(roomId)}/mute`, { muted });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function setPrivateNotifications(privateNotifications: boolean): Promise<NotificationPreferencesResponse> {
  const payload = await putJson<NotificationPreferencesResponse>('/api/notifications/privacy', { privateNotifications });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function setDoNotDisturb(dnd: boolean): Promise<NotificationPreferencesResponse> {
  const payload = await postJsonAuth<NotificationPreferencesResponse>('/api/notifications/settings', { dnd });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function setPresenceStatus(
  status: PresenceStatus,
  automatic = false
): Promise<NotificationPreferencesResponse> {
  const payload = await postJsonAuth<NotificationPreferencesResponse>('/api/presence/status', { automatic, status });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function fetchNotificationInbox(cursor?: string): Promise<unknown> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return getJsonAuth(`/api/notifications/inbox${query}`);
}

export async function markNotificationRead(notificationId: string): Promise<unknown> {
  return postJsonAuth(`/api/notifications/inbox/${encodeURIComponent(notificationId)}/read`, {});
}

export async function markAllNotificationsRead(): Promise<unknown> {
  return postJsonAuth('/api/notifications/inbox/read-all', {});
}

export type RoomNotificationLevel = 'all' | 'mentions' | 'none';

export async function fetchRoomNotificationLevel(roomId: string): Promise<RoomNotificationLevel> {
  const payload = await getJsonAuth<{ level?: RoomNotificationLevel }>(
    `/api/notifications/room/${encodeURIComponent(roomId)}/level`
  );
  return payload.level === 'all' || payload.level === 'none' ? payload.level : 'mentions';
}

export async function setRoomNotificationLevel(roomId: string, level: RoomNotificationLevel): Promise<void> {
  await putJson(`/api/notifications/room/${encodeURIComponent(roomId)}/level`, { level });
}

function normalizePreferences(preferences: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  const doNotDisturb = Boolean(preferences?.doNotDisturb);
  return {
    doNotDisturb,
    mutedPeerIds: Array.isArray(preferences?.mutedPeerIds) ? preferences.mutedPeerIds : [],
    mutedRoomIds: Array.isArray(preferences?.mutedRoomIds) ? preferences.mutedRoomIds : [],
    presenceStatus: normalizePresenceStatus(preferences?.presenceStatus, doNotDisturb ? 'dnd' : 'online'),
    presenceStatusAutomatic:
      preferences?.presenceStatus === 'away' && Boolean(preferences?.presenceStatusAutomatic),
    privateNotifications: Boolean(preferences?.privateNotifications)
  };
}
