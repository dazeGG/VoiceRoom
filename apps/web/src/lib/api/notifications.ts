import { getJsonAuth, putJson } from './http';

export interface NotificationPreferences {
  mutedPeerIds: string[];
  mutedRoomIds: string[];
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
  const payload = await putJson<NotificationMuteResponse>(`/api/notifications/rooms/${encodeURIComponent(roomId)}/mute`, { muted });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

export async function setPrivateNotifications(privateNotifications: boolean): Promise<NotificationPreferencesResponse> {
  const payload = await putJson<NotificationPreferencesResponse>('/api/notifications/privacy', { privateNotifications });
  return { ...payload, preferences: normalizePreferences(payload.preferences) };
}

function normalizePreferences(preferences: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  return {
    mutedPeerIds: Array.isArray(preferences?.mutedPeerIds) ? preferences.mutedPeerIds : [],
    mutedRoomIds: Array.isArray(preferences?.mutedRoomIds) ? preferences.mutedRoomIds : [],
    privateNotifications: Boolean(preferences?.privateNotifications)
  };
}
