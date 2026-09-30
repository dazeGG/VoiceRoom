import type {
  InboxItemRead,
  InboxPage,
  InboxReadAll,
  Muted,
  NotificationLevel,
  NotificationPreferences,
  Preferences,
  RoomLevel
} from '@voice-room/shared/contracts/notifications';
import type { PresenceStatus } from '$lib/shared/presence';
import { api } from './client';

export type { NotificationPreferences };
export type RoomNotificationLevel = NotificationLevel;

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return (await api.get<Preferences>('/api/notifications/preferences')).preferences;
}

export function setDmNotificationsMuted(userId: string, muted: boolean): Promise<Muted> {
  return api.put<Muted>(`/api/notifications/dm/${encodeURIComponent(userId)}/mute`, { muted });
}

export function setRoomNotificationsMuted(roomId: string, muted: boolean): Promise<Muted> {
  return api.put<Muted>(`/api/notifications/room/${encodeURIComponent(roomId)}/mute`, { muted });
}

export function setPrivateNotifications(privateNotifications: boolean): Promise<Preferences> {
  return api.put<Preferences>('/api/notifications/privacy', { privateNotifications });
}

export function setDoNotDisturb(dnd: boolean): Promise<Preferences> {
  return api.post<Preferences>('/api/notifications/settings', { dnd });
}

export function setPresenceStatus(status: PresenceStatus, automatic = false): Promise<Preferences> {
  return api.post<Preferences>('/api/presence/status', { automatic, status });
}

export function fetchNotificationInbox(cursor?: string): Promise<InboxPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return api.get<InboxPage>(`/api/notifications/inbox${query}`);
}

export function markNotificationRead(notificationId: string): Promise<InboxItemRead> {
  return api.post<InboxItemRead>(`/api/notifications/inbox/${encodeURIComponent(notificationId)}/read`, {});
}

export function markAllNotificationsRead(): Promise<InboxReadAll> {
  return api.post<InboxReadAll>('/api/notifications/inbox/read-all', {});
}

export async function fetchRoomNotificationLevel(roomId: string): Promise<RoomNotificationLevel> {
  return (await api.get<RoomLevel>(`/api/notifications/room/${encodeURIComponent(roomId)}/level`)).level;
}

export async function setRoomNotificationLevel(roomId: string, level: RoomNotificationLevel): Promise<void> {
  await api.put<RoomLevel>(`/api/notifications/room/${encodeURIComponent(roomId)}/level`, { level });
}
