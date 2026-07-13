import { getJsonAuth, postJsonAuth, putJson } from './http';
import { normalizePresenceStatus, type PresenceStatus } from '$lib/shared/presence';

export interface NotificationPreferences {
  doNotDisturb: boolean;
  mutedPeerIds: string[];
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

function normalizePreferences(preferences: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  const doNotDisturb = Boolean(preferences?.doNotDisturb);
  return {
    doNotDisturb,
    mutedPeerIds: Array.isArray(preferences?.mutedPeerIds) ? preferences.mutedPeerIds : [],
    presenceStatus: normalizePresenceStatus(preferences?.presenceStatus, doNotDisturb ? 'dnd' : 'online'),
    presenceStatusAutomatic:
      preferences?.presenceStatus === 'away' && Boolean(preferences?.presenceStatusAutomatic),
    privateNotifications: Boolean(preferences?.privateNotifications)
  };
}
